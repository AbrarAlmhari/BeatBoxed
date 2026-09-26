import { corsHeaders, json } from '../_shared/cors.ts'

/**
 * Proxies lrclib.net so the browser never hits it directly (CORS), per
 * docs/api-integrations.md. No API key required. Returns plain and synced
 * lyrics when lrclib has them.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { artist, track, album, durationSec } = await req.json()
    if (!artist || !track) {
      return json({ error: 'artist and track are required' }, 400)
    }

    const params = new URLSearchParams({
      artist_name: artist,
      track_name: track,
    })
    if (album) params.set('album_name', album)
    if (durationSec) params.set('duration', String(durationSec))

    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': 'Beatboxed/0.1 (CSC 305 class project)' },
    })

    // A miss is a miss: lrclib answers 404 for most, but 503 for some
    // (observed on unknown artist/track pairs). Neither is an error for us —
    // reporting them as failures would make Explore's lyrics mode look broken
    // when it simply has nothing to show.
    if (!res.ok) {
      if (res.status >= 500 && res.status !== 503) {
        return json({ error: `lrclib returned ${res.status}` }, 502)
      }
      return json({ found: false, plainLyrics: null, syncedLyrics: null })
    }

    const data = await res.json()
    return json({
      found: true,
      trackName: data.trackName ?? null,
      artistName: data.artistName ?? null,
      instrumental: data.instrumental ?? false,
      plainLyrics: data.plainLyrics ?? null,
      syncedLyrics: data.syncedLyrics ?? null,
    })
  } catch (err) {
    console.error('[lyrics-lookup]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
