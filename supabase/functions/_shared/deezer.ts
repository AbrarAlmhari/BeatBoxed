/**
 * Popularity via Deezer's public API.
 *
 * Spotify withholds `popularity` from this app and blocks every chart route,
 * so listen-derived popularity has to come from elsewhere. Deezer's search is
 * keyless and returns a `rank` field. It's matched on title + artist strings
 * rather than an id, so a remix or live cut can mismatch — hence the artist
 * sanity check below, and hence popularity staying nullable.
 *
 * Deezer allows roughly 50 requests per 5 seconds; callers cap their fan-out.
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '') // drop "(feat. X)", "(Remastered)"
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()

export async function fetchDeezerRank(
  title: string,
  artist: string
): Promise<number | null> {
  try {
    const q = encodeURIComponent(`${title} ${artist}`)
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
    if (!res.ok) return null

    const body = await res.json() as {
      data?: { rank?: number; artist?: { name?: string } }[]
    }
    const hit = body.data?.[0]
    if (!hit || typeof hit.rank !== 'number') return null

    // Reject an obviously different artist rather than storing a wrong rank.
    const theirs = norm(hit.artist?.name ?? '')
    const ours = norm(artist)
    if (theirs && ours && !theirs.startsWith(ours.slice(0, 6))) return null

    return hit.rank
  } catch {
    return null
  }
}

/** Rank several tracks, capped so one wide search can't flood Deezer. */
export async function fetchDeezerRanks(
  tracks: { id: string; title: string; artist: string }[],
  cap = 12
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const results = await Promise.all(
    tracks.slice(0, cap).map(async (t) => {
      const rank = await fetchDeezerRank(t.title, t.artist)
      return rank == null ? null : ([t.id, rank] as const)
    })
  )
  for (const hit of results) if (hit) out.set(hit[0], hit[1])
  return out
}

export type DeezerMatch = { id: number; rank: number | null; preview: string | null }

/**
 * Full match, not just the rank — song-preview needs the track id to store,
 * and the preview URL to hand straight back on a first play.
 */
export async function findDeezerTrack(
  title: string,
  artist: string
): Promise<DeezerMatch | null> {
  try {
    const q = encodeURIComponent(`${title} ${artist}`)
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
    if (!res.ok) return null

    const body = await res.json() as {
      data?: { id?: number; rank?: number; preview?: string; artist?: { name?: string } }[]
    }
    const hit = body.data?.[0]
    if (!hit?.id) return null

    // Same guard as the rank lookup: a different act means a wrong match.
    const theirs = norm(hit.artist?.name ?? '')
    const ours = norm(artist)
    if (theirs && ours && !theirs.startsWith(ours.slice(0, 6))) return null

    return {
      id: hit.id,
      rank: typeof hit.rank === 'number' ? hit.rank : null,
      preview: hit.preview || null,
    }
  } catch {
    return null
  }
}

/** Fresh signed preview link for a known track. These expire, so never cache. */
export async function fetchDeezerPreview(trackId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://api.deezer.com/track/${trackId}`)
    if (!res.ok) return null
    const body = await res.json() as { preview?: string; error?: unknown }
    if (body.error) return null
    return body.preview || null
  } catch {
    return null
  }
}
