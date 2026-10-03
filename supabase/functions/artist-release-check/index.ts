import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { getSpotifyToken } from '../_shared/spotify.ts'

/**
 * Daily sweep for new releases by artists somebody follows.
 *
 * NOT SCHEDULED AND NOT DEPLOYED. Nothing runs this until someone decides
 * to; see the note on call volume below before scheduling it.
 *
 * Only artists with at least one follower are checked — nobody needs
 * telling about an artist nobody follows, and the catalog is ~1,575 artists
 * against 16 followed ones, so this is the difference between a hundred-odd
 * calls and a couple of thousand.
 *
 * Call volume, measured against the live database rather than guessed:
 *
 *   16 artists with >= 1 follower
 *   1 call each for the newest page of their albums (limit=10, newest first)
 *   = 16 Spotify calls per run, plus 1 token request = 17 a day.
 *
 * It only ever reads the first page. A daily sweep cannot miss a release
 * unless an artist puts out more than 10 in one day, and the artist page's
 * own sync follows `next` to exhaustion anyway.
 *
 * Spotify's published rate limit is a rolling 30-second window, so the real
 * constraint is burst rather than daily total. BATCH_DELAY_MS spaces the
 * calls out; at 16 artists the whole run takes a few seconds.
 *
 * If every artist in the catalog were followed, this would be ~1,575 calls
 * a day and would want a cursor so each run handles a slice.
 */

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

/** Matches the window notify_artist_release() enforces in the database. */
const NEW_RELEASE_DAYS = 14
const BATCH_SIZE = 5
const BATCH_DELAY_MS = 1200

type SpotifyAlbum = {
  id: string
  name: string
  release_date?: string
  total_tracks?: number
  album_group?: string
  album_type?: string
  images?: { url: string }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Artists somebody follows, and that we hold a Spotify id for.
    const { data: followed, error } = await admin
      .from('follows')
      .select('artist_id, artists!inner(id, spotify_id, name)')
    if (error) throw error

    const artists = new Map<string, { id: string; spotifyId: string }>()
    for (const row of (followed ?? []) as unknown as {
      artists: { id: string; spotify_id: string | null } | null
    }[]) {
      const a = row.artists
      if (a?.spotify_id) artists.set(a.id, { id: a.id, spotifyId: a.spotify_id })
    }

    const token = await getSpotifyToken()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - NEW_RELEASE_DAYS)

    let calls = 0
    let notified = 0
    const found: string[] = []
    const list = [...artists.values()]

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (artist) => {
          try {
            // Newest first, first page only: see the note above.
            const res = await fetch(
              `https://api.spotify.com/v1/artists/${artist.spotifyId}/albums` +
                `?include_groups=album,single&limit=10&market=US`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            calls++
            if (!res.ok) return

            const body = (await res.json()) as { items?: SpotifyAlbum[] }
            const recent = (body.items ?? []).filter(
              (a) => a.release_date && new Date(a.release_date) >= cutoff
            )
            if (recent.length === 0) return

            // Which of these we had already -- asked before the upsert, or
            // everything would look pre-existing and nothing would notify.
            const { data: existing } = await admin
              .from('albums')
              .select('spotify_id')
              .in('spotify_id', recent.map((a) => a.id))
            const known = new Set((existing ?? []).map((r) => r.spotify_id))

            for (const album of recent) {
              if (known.has(album.id)) continue

              const { data: inserted, error: insertErr } = await admin
                .from('albums')
                .upsert(
                  {
                    spotify_id: album.id,
                    title: album.name,
                    artist_id: artist.id,
                    cover_url: album.images?.[0]?.url ?? null,
                    release_date: album.release_date ?? null,
                    total_tracks: album.total_tracks ?? null,
                    album_type: album.album_group ?? album.album_type ?? null,
                    cached_at: new Date().toISOString(),
                  },
                  { onConflict: 'spotify_id' }
                )
                .select('id')
                .single()
              if (insertErr || !inserted) continue

              const { data: sent } = await admin.rpc('notify_artist_release', {
                target_artist: artist.id,
                target_album: inserted.id,
              })
              notified += Number(sent ?? 0)
              found.push(`${album.name} (${album.release_date})`)
            }
          } catch (err) {
            // One artist failing must not abandon the rest of the sweep.
            console.error('[artist-release-check]', artist.spotifyId, err)
          }
        })
      )

      if (i + BATCH_SIZE < list.length) await sleep(BATCH_DELAY_MS)
    }

    return json({ artistsChecked: list.length, spotifyCalls: calls, notified, found })
  } catch (err) {
    console.error('[artist-release-check]', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
