import { supabase } from './supabase'

/**
 * 30-second previews from the iTunes Search API.
 *
 * Called from the browser rather than an Edge Function for two reasons:
 * iTunes sends `Access-Control-Allow-Origin: *`, and Deezer — the original
 * plan — blocks Supabase Edge Function egress entirely (verified with and
 * without a custom User-Agent) while sending no ACAO of its own.
 *
 * Looked up only when someone presses play, never for cards on screen, so a
 * scrolling feed can't hammer iTunes' rate limit.
 */

export type PreviewResult =
  | { status: 'ok'; url: string; trackId: number }
  | { status: 'unavailable' }

type ITunesTrack = {
  trackId: number
  trackName: string
  artistName: string
  previewUrl?: string
  kind?: string
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '') // "(feat. X)", "(Remastered)"
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Versions that aren't the recording the user tapped. */
const VARIANT = /\b(live|remix|remaster(ed)?|karaoke|cover|instrumental|acoustic|edit|version|demo)\b/i

/**
 * Closest match, not merely the first. iTunes happily returns a live cut or a
 * karaoke version above the studio recording, so candidates are scored on
 * exact title and artist agreement and penalised for variant markers.
 */
function pickBest(
  results: ITunesTrack[],
  title: string,
  artist: string
): ITunesTrack | null {
  const wantTitle = norm(title)
  const wantArtist = norm(artist)

  let best: ITunesTrack | null = null
  let bestScore = -Infinity

  for (const r of results) {
    if (!r.previewUrl) continue

    const theirTitle = norm(r.trackName ?? '')
    const theirArtist = norm(r.artistName ?? '')

    let score = 0
    if (theirTitle === wantTitle) score += 10
    else if (theirTitle.includes(wantTitle) || wantTitle.includes(theirTitle)) score += 4
    else continue // a title that doesn't overlap at all is the wrong song

    if (theirArtist === wantArtist) score += 8
    else if (theirArtist.includes(wantArtist) || wantArtist.includes(theirArtist)) score += 3
    else score -= 6 // probably a cover

    // Only penalise a variant the user didn't ask for.
    if (VARIANT.test(r.trackName ?? '') && !VARIANT.test(title)) score -= 5

    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }

  // Below this the match is a guess; "unavailable" beats playing the wrong song.
  return bestScore >= 6 ? best : null
}

async function searchITunes(term: string): Promise<ITunesTrack[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term
  )}&entity=song&limit=10`
  const res = await fetch(url)
  if (!res.ok) return []
  const body = (await res.json()) as { results?: ITunesTrack[] }
  return body.results ?? []
}

/** A known track id resolves straight to its current preview URL. */
async function lookupById(trackId: number): Promise<string | null> {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}`)
  if (!res.ok) return null
  const body = (await res.json()) as { results?: ITunesTrack[] }
  return body.results?.[0]?.previewUrl ?? null
}

/**
 * Resolves a playable preview, remembering the matched track id so each song
 * is searched once. A confirmed miss is remembered too, via
 * itunes_checked_at, so a song with no preview isn't re-searched every play.
 */
export async function getPreview(song: {
  id: string
  title: string
  artistName: string
  itunesTrackId?: number | null
  itunesCheckedAt?: string | null
}): Promise<PreviewResult> {
  try {
    if (song.itunesTrackId) {
      const url = await lookupById(song.itunesTrackId)
      if (url) return { status: 'ok', url, trackId: song.itunesTrackId }
    }

    // Already searched and found nothing — don't ask again.
    if (!song.itunesTrackId && song.itunesCheckedAt) return { status: 'unavailable' }

    const results = await searchITunes(`${song.artistName} ${song.title}`)
    const best = pickBest(results, song.title, song.artistName)

    // Record the outcome either way, so the next play skips the search.
    if (supabase) {
      void supabase
        .from('songs')
        .update({
          itunes_track_id: best?.trackId ?? null,
          itunes_checked_at: new Date().toISOString(),
        })
        .eq('id', song.id)
        .then(({ error }) => {
          if (error) console.warn('[beatboxed] could not cache iTunes id:', error.message)
        })
    }

    if (!best?.previewUrl) return { status: 'unavailable' }
    return { status: 'ok', url: best.previewUrl, trackId: best.trackId }
  } catch (err) {
    console.error('[beatboxed] preview lookup failed:', err)
    return { status: 'unavailable' }
  }
}
