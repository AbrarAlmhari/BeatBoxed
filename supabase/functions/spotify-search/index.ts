import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { getSpotifyToken, pickImage } from '../_shared/spotify.ts'

/**
 * Cache-on-first-lookup, per docs/api-integrations.md — search Spotify, upsert
 * the hits into our own artists/albums/songs tables matched on spotify_id, and
 * return OUR row shape so the frontend never sees Spotify's payload.
 *
 * Genre note: this app's Spotify credentials no longer return `genres` on
 * artists (restricted for apps created after late 2024), and tracks never
 * carried one. The optional `genre` argument lets the caller tag what it is
 * deliberately fetching — the seed script passes it, user searches don't.
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

/** Upsert artists by spotify_id and return a spotify_id -> our uuid map. */
async function upsertArtists(
  artists: SpotifyArtist[],
  genre: string | null
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (artists.length === 0) return map

  const byId = new Map(artists.map((a) => [a.id, a]))
  const now = new Date().toISOString()
  const rows = [...byId.values()].map((a) => ({
    spotify_id: a.id,
    name: a.name,
    image_url: pickImage(a.images),
    genres: a.genres?.length ? a.genres : genre ? [genre] : [],
    cached_at: now,
  }))

  const { data, error } = await admin
    .from('artists')
    .upsert(rows, { onConflict: 'spotify_id' })
    .select('id, spotify_id')

  if (error) throw error
  for (const row of data ?? []) map.set(row.spotify_id, row.id)
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
    .map((a) => ({
      spotify_id: a.id,
      title: a.name,
      artist_id: artistIds.get(a.artists[0]?.id) ?? null,
      cover_url: pickImage(a.images),
      cached_at: new Date().toISOString(),
      release_date: a.release_date?.length === 4
        ? `${a.release_date}-01-01` // Spotify may return year-only precision
        : a.release_date ?? null,
    }))
    .filter((r) => r.artist_id)

  if (rows.length === 0) return map

  const { data, error } = await admin
    .from('albums')
    .upsert(rows, { onConflict: 'spotify_id' })
    .select('id, spotify_id')

  if (error) throw error
  for (const row of data ?? []) map.set(row.spotify_id, row.id)
  return map
}

async function upsertSongs(
  tracks: SpotifyTrack[],
  artistIds: Map<string, string>,
  albumIds: Map<string, string>,
  genre: string | null
) {
  const rows = tracks
    .map((t) => ({
      spotify_id: t.id,
      title: t.name,
      artist_id: artistIds.get(t.artists[0]?.id) ?? null,
      album_id: albumIds.get(t.album.id) ?? null,
      duration_ms: t.duration_ms,
      genre,
      cached_at: new Date().toISOString(),
    }))
    .filter((r) => r.artist_id && r.album_id)

  if (rows.length === 0) return []

  const { data, error } = await admin
    .from('songs')
    .upsert(rows, { onConflict: 'spotify_id' })
    .select('id, spotify_id, title, artist_id, album_id, duration_ms, genre')

  if (error) throw error
  return data ?? []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { q, type = 'track', limit = 20, genre = null } = await req.json()
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
    url.searchParams.set('limit', String(Math.min(Number(limit) || 20, 50)))

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      return json({ error: `Spotify search failed: ${res.status}` }, 502)
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

    const tracks: SpotifyTrack[] = payload.tracks?.items ?? []
    // Track results carry nested artist/album stubs; cache those first so the
    // song rows have real foreign keys to point at.
    const artistRefs = tracks.flatMap((t) => [...t.artists, ...t.album.artists])
    const artistIds = await upsertArtists(
      artistRefs.map((a) => ({ id: a.id, name: a.name })),
      genre
    )
    const albumIds = await upsertAlbums(tracks.map((t) => t.album), artistIds)
    const songs = await upsertSongs(tracks, artistIds, albumIds, genre)

    return json({ type: 'track', songs, cached: songs.length })
  } catch (err) {
    console.error('[spotify-search]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
