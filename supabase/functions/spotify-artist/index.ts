import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { getSpotifyToken, pickImage } from '../_shared/spotify.ts'

/**
 * Fills the artist and album pages' cache.
 *
 * Three jobs, picked by `action`:
 *   discography — artist details + every album and single, then notify
 *                 followers about anything genuinely new
 *   album       — one album's full track list, in track order
 *   bio         — the Wikipedia summary, matched through Wikidata
 *
 * What this app's Spotify credentials actually allow, verified through a
 * deployed function rather than assumed:
 *
 *   /v1/artists/{id}            200
 *   /v1/artists/{id}/albums     200, but limit caps at 10 (20 is 400)
 *   /v1/albums/{id}             200
 *   /v1/albums/{id}/tracks      200
 *   /v1/artists/{id}/top-tracks 403  <- there is no top-tracks here
 *   /v1/artists?ids=            403  <- no batch artist lookup
 *
 * The artist object is also thinner than Spotify's docs suggest: its only
 * keys are external_urls, href, id, images, name, type, uri. No genres, no
 * followers, no popularity. Anything the pages show beyond name and image
 * comes from our own data or from Wikipedia.
 */

type SpotifyArtistRef = { id: string; name: string }
type SpotifyImage = { url: string; width: number; height: number }

type SpotifyArtist = {
  id: string
  name: string
  images?: SpotifyImage[]
  genres?: string[]
}

type SpotifyAlbum = {
  id: string
  name: string
  album_type?: string
  album_group?: string
  images?: SpotifyImage[]
  release_date?: string
  total_tracks?: number
  artists: SpotifyArtistRef[]
}

type SpotifyAlbumTrack = {
  id: string
  name: string
  duration_ms: number
  track_number: number
  disc_number: number
  artists: SpotifyArtistRef[]
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // Service role: cache fills, and RLS on the catalog tables blocks client
  // writes by design.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

/** Spotify rejects limit > 10 for this app, on search and on albums alike. */
const PAGE = 10
/** A release counts as new only this close to today. */
const NEW_RELEASE_DAYS = 14

async function spotify(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`Spotify ${res.status} on ${new URL(url).pathname}`)
  }
  return res.json()
}

/* ------------------------------------------------------------- upserts */

/** Returns spotify_id -> our uuid, creating rows that don't exist yet. */
async function upsertArtists(
  refs: { id: string; name: string; image?: string | null }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = new Map<string, (typeof refs)[number]>()
  for (const r of refs) if (r?.id) unique.set(r.id, r)
  if (unique.size === 0) return map

  const rows = [...unique.values()].map((r) => ({
    spotify_id: r.id,
    name: r.name,
    // Only overwrite the image when we actually have one, so an artist
    // cached with artwork isn't blanked by a track stub that has none.
    ...(r.image ? { image_url: r.image } : {}),
    cached_at: new Date().toISOString(),
  }))

  const { data, error } = await admin
    .from('artists')
    .upsert(rows, { onConflict: 'spotify_id' })
    .select('id, spotify_id')
  if (error) throw error
  for (const row of data ?? []) map.set(row.spotify_id, row.id)
  return map
}

/**
 * Upserts albums and reports which ones we had never seen before.
 *
 * "Was it already there" has to be answered *before* the upsert, or every
 * album looks pre-existing and nothing is ever treated as a new release.
 */
async function upsertAlbums(
  albums: SpotifyAlbum[],
  artistIds: Map<string, string>
): Promise<{ ids: Map<string, string>; freshSpotifyIds: Set<string> }> {
  const ids = new Map<string, string>()
  const freshSpotifyIds = new Set<string>()
  if (albums.length === 0) return { ids, freshSpotifyIds }

  const spotifyIds = albums.map((a) => a.id)
  const { data: existing, error: existingErr } = await admin
    .from('albums')
    .select('spotify_id')
    .in('spotify_id', spotifyIds)
  if (existingErr) throw existingErr
  const known = new Set((existing ?? []).map((r) => r.spotify_id))
  for (const id of spotifyIds) if (!known.has(id)) freshSpotifyIds.add(id)

  const rows = albums.map((a) => ({
    spotify_id: a.id,
    title: a.name,
    // Primary artist only, the same rule spotify-search follows.
    artist_id: artistIds.get(a.artists[0]?.id) ?? null,
    cover_url: pickImage(a.images),
    release_date: a.release_date ?? null,
    total_tracks: a.total_tracks ?? null,
    album_type: a.album_group ?? a.album_type ?? null,
    cached_at: new Date().toISOString(),
  }))

  const { data, error } = await admin
    .from('albums')
    .upsert(rows, { onConflict: 'spotify_id' })
    .select('id, spotify_id')
  if (error) throw error
  for (const row of data ?? []) ids.set(row.spotify_id, row.id)

  return { ids, freshSpotifyIds }
}

/* --------------------------------------------------------- discography */

/**
 * Every album and single, following `next` to exhaustion.
 *
 * Pages come back ragged — Radiohead reports total=45 but returns 10, 5, 10,
 * 10, 5 across offsets — so page counts computed from `total` silently
 * truncate a discography. Only `next` being null means finished.
 */
async function fetchAllAlbums(
  artistSpotifyId: string,
  token: string
): Promise<SpotifyAlbum[]> {
  const all: SpotifyAlbum[] = []
  const seen = new Set<string>()
  let url: string | null =
    `https://api.spotify.com/v1/artists/${artistSpotifyId}/albums` +
    `?include_groups=album,single&limit=${PAGE}&market=US`

  // A hard stop so a paging bug can't loop against Spotify forever.
  for (let page = 0; url && page < 20; page++) {
    const body: { items?: SpotifyAlbum[]; next?: string | null } = await spotify(
      url,
      token
    )
    for (const album of body.items ?? []) {
      if (!seen.has(album.id)) {
        seen.add(album.id)
        all.push(album)
      }
    }
    url = body.next ?? null
  }
  return all
}

async function syncDiscography(artistSpotifyId: string, token: string) {
  const detail: SpotifyArtist = await spotify(
    `https://api.spotify.com/v1/artists/${artistSpotifyId}`,
    token
  )

  const artistIds = await upsertArtists([
    { id: detail.id, name: detail.name, image: pickImage(detail.images) },
  ])
  const artistId = artistIds.get(detail.id)
  if (!artistId) throw new Error('artist upsert returned no row')

  const albums = await fetchAllAlbums(artistSpotifyId, token)

  // Albums can credit artists we've never cached; their rows are needed
  // before the album can point at one.
  const collaborators = albums
    .map((a) => a.artists[0])
    .filter((a): a is SpotifyArtistRef => Boolean(a?.id))
  const allArtistIds = await upsertArtists([
    { id: detail.id, name: detail.name, image: pickImage(detail.images) },
    ...collaborators.map((c) => ({ id: c.id, name: c.name })),
  ])

  const { ids, freshSpotifyIds } = await upsertAlbums(albums, allArtistIds)

  // Has this artist ever been synced? Read before the stamp is written.
  const { data: artistRow } = await admin
    .from('artists')
    .select('discography_synced_at')
    .eq('id', artistId)
    .maybeSingle()
  const firstEverSync = !artistRow?.discography_synced_at

  await admin
    .from('artists')
    .update({ discography_synced_at: new Date().toISOString() })
    .eq('id', artistId)

  /*
   * Notify only for a release that is genuinely new: recent *and* absent
   * from our database until this sync.
   *
   * The first sync of an artist is skipped outright. Every album they have
   * ever made is "new to us" at that moment, and a reissue or a single
   * dated last week would otherwise notify every follower the first time
   * anyone opened the page.
   */
  let notified = 0
  if (!firstEverSync) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - NEW_RELEASE_DAYS)

    for (const album of albums) {
      if (!freshSpotifyIds.has(album.id)) continue
      if (!album.release_date) continue
      // Spotify dates can be year-only ("1997"); Date handles the precise
      // ones and year-only releases are never within 14 days anyway.
      if (new Date(album.release_date) < cutoff) continue

      const albumId = ids.get(album.id)
      if (!albumId) continue

      const { data, error } = await admin.rpc('notify_artist_release', {
        target_artist: artistId,
        target_album: albumId,
      })
      if (error) console.error('[spotify-artist] notify failed:', error.message)
      else notified += Number(data ?? 0)
    }
  }

  return {
    artistId,
    albums: albums.length,
    newReleases: freshSpotifyIds.size,
    firstEverSync,
    notified,
  }
}

/* -------------------------------------------------------- album tracks */

async function syncAlbumTracks(albumSpotifyId: string, token: string) {
  const detail: SpotifyAlbum = await spotify(
    `https://api.spotify.com/v1/albums/${albumSpotifyId}`,
    token
  )

  const albumArtist = detail.artists[0]
  const artistIds = await upsertArtists(
    albumArtist ? [{ id: albumArtist.id, name: albumArtist.name }] : []
  )
  const { ids } = await upsertAlbums([detail], artistIds)
  const albumId = ids.get(detail.id)
  if (!albumId) throw new Error('album upsert returned no row')

  // Album tracks page at 50, unlike search and artist albums.
  const tracks: SpotifyAlbumTrack[] = []
  let url: string | null =
    `https://api.spotify.com/v1/albums/${albumSpotifyId}/tracks?limit=50`
  for (let page = 0; url && page < 10; page++) {
    const body: { items?: SpotifyAlbumTrack[]; next?: string | null } =
      await spotify(url, token)
    tracks.push(...(body.items ?? []))
    url = body.next ?? null
  }

  // Each track keeps its own primary artist, so a feature by someone else
  // still shows under their name on the album.
  const trackArtists = tracks
    .map((t) => t.artists[0])
    .filter((a): a is SpotifyArtistRef => Boolean(a?.id))
  const allArtistIds = await upsertArtists([
    ...(albumArtist ? [{ id: albumArtist.id, name: albumArtist.name }] : []),
    ...trackArtists.map((a) => ({ id: a.id, name: a.name })),
  ])

  if (tracks.length > 0) {
    const rows = tracks.map((t) => ({
      spotify_id: t.id,
      title: t.name,
      artist_id: allArtistIds.get(t.artists[0]?.id) ?? null,
      album_id: albumId,
      duration_ms: t.duration_ms,
      track_number: t.track_number,
      disc_number: t.disc_number,
      cached_at: new Date().toISOString(),
    }))
    const { error } = await admin
      .from('songs')
      .upsert(rows, { onConflict: 'spotify_id' })
    if (error) throw error
  }

  return { albumId, tracks: tracks.length, totalTracks: detail.total_tracks ?? null }
}

/* ------------------------------------------------------------ wikipedia */

/**
 * The artist's Wikipedia summary, found through Wikidata's Spotify artist ID
 * property (P1902) rather than by name.
 *
 * Name matching is what makes bios wrong: a band called "Low" or "Girls"
 * would pick up an article about something else entirely. No P1902 match
 * means no bio — an empty About section is better than a confident lie.
 */
async function fetchBio(artistSpotifyId: string) {
  const sparql = `
    SELECT ?article WHERE {
      ?artist wdt:P1902 "${artistSpotifyId}" .
      ?article schema:about ?artist ;
               schema:isPartOf <https://en.wikipedia.org/> .
    } LIMIT 1`

  const res = await fetch(
    'https://query.wikidata.org/sparql?format=json&query=' +
      encodeURIComponent(sparql),
    { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Beatboxed/1.0 (class project)' } }
  )
  if (!res.ok) return null

  const body = await res.json() as {
    results?: { bindings?: { article?: { value?: string } }[] }
  }
  const article = body.results?.bindings?.[0]?.article?.value
  if (!article) return null

  const title = decodeURIComponent(article.split('/wiki/')[1] ?? '')
  if (!title) return null

  const summaryRes = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: { 'User-Agent': 'Beatboxed/1.0 (class project)' } }
  )
  if (!summaryRes.ok) return null

  const summary = await summaryRes.json() as { extract?: string }
  if (!summary.extract) return null

  return { bio: summary.extract, url: article }
}

/* ----------------------------------------------------------------- serve */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { action, spotifyId } = await req.json() as {
      action?: string
      spotifyId?: string
    }
    if (!spotifyId) return json({ error: 'spotifyId is required' }, 400)

    const token = await getSpotifyToken()

    if (action === 'album') {
      return json(await syncAlbumTracks(spotifyId, token))
    }

    if (action === 'bio') {
      const found = await fetchBio(spotifyId)
      const { error } = await admin
        .from('artists')
        .update({
          bio: found?.bio ?? null,
          bio_url: found?.url ?? null,
          // Stamped either way, so a confirmed miss isn't retried on every
          // visit to the page.
          bio_fetched_at: new Date().toISOString(),
        })
        .eq('spotify_id', spotifyId)
      if (error) throw error
      return json({ bio: found?.bio ?? null, url: found?.url ?? null })
    }

    return json(await syncDiscography(spotifyId, token))
  } catch (err) {
    console.error('[spotify-artist]', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
