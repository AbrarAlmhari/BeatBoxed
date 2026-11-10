import { createClient } from 'jsr:@supabase/supabase-js@2'
import { callerOf, notLoggedIn } from '../_shared/auth.ts'
import { corsHeaders, json, serverError } from '../_shared/cors.ts'
import { upsertByShape } from '../_shared/upsertByShape.ts'
import { logError } from '../_shared/log.ts'
import { getSpotifyToken, pickImage } from '../_shared/spotify.ts'
import { fetchDeezerRanks } from '../_shared/deezer.ts'
import { readSpotifyFailure, SpotifyRefused, spotifyFailureBody } from '../_shared/spotifyFailure.ts'

/**
 * Cache-on-first-lookup, per docs/api-integrations.md — search Spotify, upsert
 * the hits into our own artists/albums/songs tables matched on spotify_id, and
 * return OUR row shape so the frontend never sees Spotify's payload.
 *
 * Genre note: this app's Spotify credentials no longer return `genres` on
 * artists (restricted for apps created after late 2024), and tracks never
 * carried one. The optional `genre` argument lets the caller tag what it is
 * deliberately fetching. Only the seed script may pass it (it holds the service
 * role key); from anyone else it's ignored, so a user can't relabel the catalog.
 */

type SpotifyArtistRef = { id: string; name: string }
type SpotifyAlbum = {
  id: string
  name: string
  images?: { url: string; width: number; height: number }[]
  release_date?: string
  artists: SpotifyArtistRef[]
}
type SpotifyTrack = {
  id: string
  name: string
  duration_ms: number
  album: SpotifyAlbum
  artists: SpotifyArtistRef[]
}
type SpotifyArtist = {
  id: string
  name: string
  images?: { url: string; width: number; height: number }[]
  genres?: string[]
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // Service role: these upserts are a server-side cache fill, and RLS on the
  // catalog tables intentionally blocks client writes.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

/**
 * Track search returns artist *stubs* with no images, so artists cached that
 * way had none. The batch /v1/artists?ids= endpoint is 403 for this app, but
 * single /v1/artists/{id} works — enrich through that, capped so a wide search
 * can't fan out into dozens of calls.
 */
async function fetchArtistImages(
  ids: string[],
  token: string,
  cap = 12
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const results = await Promise.all(
    ids.slice(0, cap).map(async (id) => {
      try {
        const r = await fetch(`https://api.spotify.com/v1/artists/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) return null
        const a = await r.json() as SpotifyArtist
        const img = pickImage(a.images)
        return img ? ([id, img] as const) : null
      } catch {
        return null
      }
    })
  )
  for (const hit of results) if (hit) found.set(hit[0], hit[1])
  return found
}

/**
 * Upsert artists by spotify_id, returning spotify_id -> our uuid.
 *
 * An image or genres we don't have are left out, so what's already saved stays.
 */
async function upsertArtists(
  artists: SpotifyArtist[],
  genre: string | null,
  images?: Map<string, string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (artists.length === 0) return map

  const byId = new Map(artists.map((a) => [a.id, a]))
  const now = new Date().toISOString()

  const rows = [...byId.values()].map((a) => {
    const image = pickImage(a.images) ?? images?.get(a.id)
    const genres = a.genres?.length ? a.genres : genre ? [genre] : null
    return {
      spotify_id: a.id,
      name: a.name,
      cached_at: now,
      ...(image ? { image_url: image } : {}),
      ...(genres ? { genres } : {}),
    }
  })

  const saved = await upsertByShape<{ id: string; spotify_id: string }>(admin, 'artists', rows, 'id, spotify_id')
  for (const row of saved) map.set(row.spotify_id, row.id)
  return map
}

async function upsertAlbums(
  albums: SpotifyAlbum[],
  artistIds: Map<string, string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (albums.length === 0) return map

  const byId = new Map(albums.map((a) => [a.id, a]))
  const rows = [...byId.values()]
    .map((a) => {
      const cover = pickImage(a.images)
      return {
        spotify_id: a.id,
        title: a.name,
        artist_id: artistIds.get(a.artists[0]?.id) ?? null,
        // Left out when missing, so what's saved stays.
        ...(cover ? { cover_url: cover } : {}),
        cached_at: new Date().toISOString(),
        ...(a.release_date
          ? {
              release_date: a.release_date.length === 4
                ? `${a.release_date}-01-01` // Spotify may return year-only precision
                : a.release_date,
            }
          : {}),
      }
    })
    .filter((r) => r.artist_id)

  if (rows.length === 0) return map

  const saved = await upsertByShape<{ id: string; spotify_id: string }>(admin, 'albums', rows, 'id, spotify_id')
  for (const row of saved) map.set(row.spotify_id, row.id)
  return map
}

async function upsertSongs(
  tracks: SpotifyTrack[],
  artistIds: Map<string, string>,
  albumIds: Map<string, string>,
  genre: string | null,
  ranks: Map<string, number>
) {
  const rows = tracks
    .map((t) => {
      const popularity = ranks.get(t.id)
      return {
        spotify_id: t.id,
        title: t.name,
        artist_id: artistIds.get(t.artists[0]?.id) ?? null,
        album_id: albumIds.get(t.album.id) ?? null,
        duration_ms: t.duration_ms,
        cached_at: new Date().toISOString(),
        // Left out when unknown, so a saved genre or popularity stays.
        ...(genre ? { genre } : {}),
        ...(popularity != null ? { popularity } : {}),
      }
    })
    .filter((r) => r.artist_id && r.album_id)

  if (rows.length === 0) return []

  return await upsertByShape(
    admin,
    'songs',
    rows,
    'id, spotify_id, title, artist_id, album_id, duration_ms, genre, popularity'
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await callerOf(req)
    if (!caller) return notLoggedIn()

    const {
      q,
      type = 'track',
      limit = 10,
      genre: askedGenre = null,
      // When set, only keep tracks whose primary artist is this artist. A bare
      // name query matches song titles too: searching "Cigarettes After Sex"
      // returns tracks by MATUNA and Rod Wave alongside the actual band.
      artistName = null,
    } = await req.json()
    const genre = caller === 'service' ? askedGenre : null
    if (!q || typeof q !== 'string') {
      return json({ error: 'q is required' }, 400)
    }
    if (type !== 'track' && type !== 'artist') {
      return json({ error: "type must be 'track' or 'artist'" }, 400)
    }

    const token = await getSpotifyToken()
    const url = new URL('https://api.spotify.com/v1/search')
    url.searchParams.set('q', q)
    url.searchParams.set('type', type)
    // This app's credentials 400 on any search limit above 10 — another
    // restriction that applies to apps created after late 2024. Clamp here so
    // no caller can trip it.
    url.searchParams.set('limit', String(Math.min(Number(limit) || 10, 10)))

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      throw new SpotifyRefused('Spotify search', await readSpotifyFailure(res))
    }
    const payload = await res.json()

    if (type === 'artist') {
      const artists: SpotifyArtist[] = payload.artists?.items ?? []
      const ids = await upsertArtists(artists, genre)
      const { data, error } = await admin
        .from('artists')
        .select('id, spotify_id, name, image_url, genres')
        .in('id', [...ids.values()])
      if (error) throw error
      return json({ type: 'artist', artists: data ?? [] })
    }

    let tracks: SpotifyTrack[] = payload.tracks?.items ?? []

    if (artistName) {
      const want = String(artistName).trim().toLowerCase()
      tracks = tracks.filter((t) =>
        t.artists.some((a) => a.name.trim().toLowerCase() === want)
      )
    }

    // Only each track's primary artist and each album's own primary artist —
    // the two the catalog actually points at.
    //
    // This used to cache every featured and album-level artist too, leaving
    // 555 of 903 artist rows owning no songs, no albums and no follows. Those
    // extras also surfaced as apparent duplicates, because Spotify has
    // several distinct artists sharing a name.
    const artistRefs = [
      ...tracks.map((t) => t.artists[0]),
      ...tracks.map((t) => t.album.artists[0]),
    ].filter((a): a is SpotifyArtistRef => Boolean(a?.id))
    const uniqueArtistIds = [...new Set(artistRefs.map((a) => a.id))]
    const images = await fetchArtistImages(uniqueArtistIds, token)

    const artistIds = await upsertArtists(
      artistRefs.map((a) => ({ id: a.id, name: a.name })),
      genre,
      images
    )
    const albumIds = await upsertAlbums(tracks.map((t) => t.album), artistIds)

    // Spotify gives this app no popularity figure, so rank via Deezer.
    const ranks = await fetchDeezerRanks(
      tracks.map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists[0]?.name ?? '',
      }))
    )
    const songs = await upsertSongs(tracks, artistIds, albumIds, genre, ranks)

    return json({
      type: 'track',
      songs,
      cached: songs.length,
      artistsWithImages: images.size,
      ranked: ranks.size,
    })
  } catch (err) {
    if (err instanceof SpotifyRefused) {
      logError('spotify-search', 'Spotify refused', { call: err.what, status: err.failure.status, code: err.failure.code, retryAfterSeconds: err.failure.retryAfterSeconds, reason: err.failure.reason })
      return json(spotifyFailureBody(err.failure), 502)
    }
    return serverError('spotify-search', err)
  }
})
