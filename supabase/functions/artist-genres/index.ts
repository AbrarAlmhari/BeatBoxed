import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

/**
 * Fetches one artist's genres the first time they're needed (the artist
 * page asks when genres_fetched_at is still null), the same way
 * scripts/backfill-artist-genres.mjs does for the back catalogue:
 *
 *   1. Wikidata "genre" (P136) of the item with this Spotify artist ID
 *      (P1902), English labels. Matched by ID, never by name.
 *   2. MusicBrainz: the artist linked to the Spotify URL, its genres (or
 *      tags with 2+ votes). One artist page open is at most two requests.
 *   3. Nothing: genres_source 'none', stamped so it isn't asked again.
 *
 * Writes go through the service role (the catalog tables have no client
 * write policies). Already-fetched artists return straight away. No keys.
 *
 * Body: { artistId }. Returns { genres: string[] } (the buckets, from
 * artist_genre_buckets in the database).
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const USER_AGENT = 'Beatboxed/1.0 (class project; https://github.com/AbrarAlmhari/BeatBoxed)'

async function wikidataGenres(spotifyId: string): Promise<string[]> {
  const query = `SELECT DISTINCT ?label WHERE {
    ?artist wdt:P1902 "${spotifyId.replace(/"/g, '')}" ; wdt:P136 ?genre .
    ?genre rdfs:label ?label . FILTER(lang(?label) = 'en')
  }`
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
  })
  if (!res.ok) return []
  const body = (await res.json()) as { results?: { bindings?: { label?: { value?: string } }[] } }
  return (body.results?.bindings ?? []).map((b) => b.label?.value).filter((v): v is string => Boolean(v))
}

async function musicbrainzGenres(spotifyId: string): Promise<string[]> {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT }
  const link = await fetch(
    `https://musicbrainz.org/ws/2/url?resource=${encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`)}&inc=artist-rels&fmt=json`,
    { headers }
  )
  if (!link.ok) return []
  const linked = (await link.json()) as { relations?: { artist?: { id: string } }[] }
  const mbid = linked.relations?.find((r) => r.artist)?.artist?.id
  if (!mbid) return []
  // MusicBrainz allows one request a second.
  await new Promise((r) => setTimeout(r, 1100))
  const res = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=genres+tags&fmt=json`, { headers })
  if (!res.ok) return []
  const artist = (await res.json()) as {
    genres?: { name: string; count: number }[]
    tags?: { name: string; count: number }[]
  }
  const genres = (artist.genres ?? []).filter((g) => g.count > 0).sort((a, b) => b.count - a.count)
  if (genres.length) return genres.slice(0, 8).map((g) => g.name)
  return (artist.tags ?? [])
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((t) => t.name)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { artistId } = (await req.json()) as { artistId?: string }
    if (!artistId) return json({ error: 'artistId is required' }, 400)

    const { data: artist, error } = await admin
      .from('artists')
      .select('id, spotify_id, genres_fetched_at, genre_buckets')
      .eq('id', artistId)
      .maybeSingle()
    if (error) throw error
    if (!artist) return json({ error: 'not found' }, 404)
    if (artist.genres_fetched_at || !artist.spotify_id) return json({ genres: artist.genre_buckets ?? [] })

    let raw = await wikidataGenres(artist.spotify_id)
    let source: 'wikidata' | 'musicbrainz' | 'none' = 'wikidata'
    if (!raw.length) {
      raw = await musicbrainzGenres(artist.spotify_id)
      source = raw.length ? 'musicbrainz' : 'none'
    }

    const { data: saved, error: saveErr } = await admin
      .from('artists')
      .update({ genres_raw: raw.length ? raw : null, genres_source: source, genres_fetched_at: new Date().toISOString() })
      .eq('id', artistId)
      .select('genre_buckets')
      .single()
    if (saveErr) throw saveErr
    return json({ genres: saved.genre_buckets ?? [] })
  } catch (err) {
    console.error('[artist-genres]', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
