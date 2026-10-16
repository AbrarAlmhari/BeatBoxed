import { supabase } from './supabase'

/**
 * The profile's Stats tab. One database call, get_user_stats(), returns the
 * whole tab for a time range; privacy is the database's (can_view_profile),
 * so a private account's stats come back as null to anyone not allowed.
 */

function client() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export type StatsRange = 'all' | 'year' | '30d'

export const STATS_RANGES: { id: StatsRange; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'This year' },
  { id: '30d', label: '30 days' },
]

/** Fewer ratings than this in a range and the tab shows the warm-up state. */
export const STATS_MIN_RATINGS = 5

export type StatsArtist = {
  id: string
  name: string
  photo: string | null
  count: number
  average: number
}

export type UserStats = {
  total: number
  average: number | null
  artists: number
  /** Ratings per star: [1★, 2★, 3★, 4★, 5★]. */
  spread: [number, number, number, number, number]
  topArtists: StatsArtist[]
  /** Every decade from their earliest to the 2020s, zeros included. */
  decades: { decade: number; label: string; count: number }[]
}

type Raw = {
  total: number
  average: number | null
  artists: number
  spread: number[]
  top_artists: { id: string; name: string; photo: string | null; count: number; average: number }[]
  decades: { decade: number; count: number }[]
}

/** "70s", "00s", "2020s" isn't needed: two digits read cleanly on a chart. */
export function decadeLabel(decade: number) {
  return `${String(decade % 100).padStart(2, '0')}s`
}

/**
 * Fills the gaps between their earliest decade and the current one, so the
 * chart's x-axis is continuous (a decade with nothing rated shows as 0).
 */
function fillDecades(rows: Raw['decades']) {
  if (rows.length === 0) return []
  const counts = new Map(rows.map((r) => [r.decade, r.count]))
  const first = Math.min(...rows.map((r) => r.decade))
  const last = Math.max(Math.floor(new Date().getFullYear() / 10) * 10, ...rows.map((r) => r.decade))
  const out: UserStats['decades'] = []
  for (let d = first; d <= last; d += 10) {
    out.push({ decade: d, label: decadeLabel(d), count: counts.get(d) ?? 0 })
  }
  return out
}

/** null when the viewer isn't allowed to see this profile's stats. */
export async function getUserStats(userId: string, range: StatsRange): Promise<UserStats | null> {
  const { data, error } = await client().rpc('get_user_stats', { p_user_id: userId, p_range: range })
  if (error) throw error
  if (!data) return null
  const raw = data as Raw
  return {
    total: raw.total,
    average: raw.average == null ? null : Number(raw.average),
    artists: raw.artists,
    spread: [0, 1, 2, 3, 4].map((i) => raw.spread?.[i] ?? 0) as UserStats['spread'],
    topArtists: (raw.top_artists ?? []).map((a) => ({ ...a, average: Number(a.average) })),
    decades: fillDecades(raw.decades ?? []),
  }
}

/** Since when a range counts, for the "See all" list (null: all time). */
export function rangeStart(range: StatsRange): Date | null {
  const now = new Date()
  if (range === 'year') return new Date(now.getFullYear(), 0, 1)
  if (range === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return null
}

/**
 * Every artist they've rated in a range, most rated first: the "See all"
 * list. Read through the reviews RLS (can_view_profile), so it only ever
 * returns what the viewer may see.
 */
export async function getAllRatedArtists(userId: string, range: StatsRange): Promise<StatsArtist[]> {
  let q = client()
    .from('reviews')
    .select('rating, songs!inner(artist_id, artists!inner(id, name, image_url))')
    .eq('user_id', userId)
    .gte('rating', 1)
  const since = rangeStart(range)
  if (since) q = q.gte('created_at', since.toISOString())
  const { data, error } = await q.limit(2000)
  if (error) throw error

  type Row = { rating: number; songs: { artists: { id: string; name: string; image_url: string | null } } }
  const byArtist = new Map<string, StatsArtist & { sum: number }>()
  for (const row of (data ?? []) as unknown as Row[]) {
    const a = row.songs.artists
    const cur = byArtist.get(a.id) ?? { id: a.id, name: a.name, photo: a.image_url, count: 0, average: 0, sum: 0 }
    cur.count += 1
    cur.sum += row.rating
    byArtist.set(a.id, cur)
  }
  return [...byArtist.values()]
    .map(({ sum, ...a }) => ({ ...a, average: Math.round((sum / a.count) * 10) / 10 }))
    .sort((x, y) => y.count - x.count || y.average - x.average || x.name.localeCompare(y.name))
}

/** A piece of Beatie's take; strong pieces are bold. */
export type TakePart = { text: string; strong?: boolean }

const DECADE_WORDS: Record<number, string> = {
  1950: '1950s', 1960: '60s', 1970: '70s', 1980: '80s', 1990: '90s', 2000: '2000s', 2010: '2010s', 2020: '2020s',
}

/**
 * Beatie's take: one or two sentences built from the numbers with a few
 * templates. No AI call. Phrased without "you" or "they", so it reads the
 * same on your own profile and on someone else's.
 */
export function beatieTake(stats: UserStats, range: StatsRange): TakePart[] {
  const parts: TakePart[] = []
  const [one, two, , four, five] = stats.spread
  const high = (four + five) / stats.total
  const low = (one + two) / stats.total
  const top = stats.topArtists[0]
  const favDecade = [...stats.decades].sort((a, b) => b.count - a.count)[0]
  const decadeShare = favDecade ? favDecade.count / stats.total : 0

  // First sentence: what the listening leans toward.
  if (range !== 'all' && top && top.count >= 2 && top.count / stats.total >= 0.25) {
    parts.push(
      { text: 'A busy stretch for ' },
      { text: top.name, strong: true },
      { text: `: ${top.count} of ${stats.total} ratings, averaging ${top.average.toFixed(1)}★.` }
    )
  } else if (favDecade && decadeShare >= 0.4) {
    parts.push(
      { text: 'Mostly songs from the ' },
      { text: DECADE_WORDS[favDecade.decade] ?? `${favDecade.decade}s`, strong: true },
      { text: '.' }
    )
  } else if (top && top.count >= 3) {
    parts.push({ text: top.name, strong: true }, { text: ` comes up the most, with ${top.count} songs rated.` })
  } else if (stats.artists / stats.total >= 0.8) {
    parts.push({ text: `Rarely the same artist twice: ${stats.artists} artists across ${stats.total} songs.` })
  } else if (favDecade) {
    parts.push(
      { text: 'A wide spread of decades, leaning toward the ' },
      { text: DECADE_WORDS[favDecade.decade] ?? `${favDecade.decade}s`, strong: true },
      { text: '.' }
    )
  }

  // Second sentence: how the stars get handed out.
  const avg = (stats.average ?? 0).toFixed(1)
  if (five === stats.total) {
    parts.push({ text: `${parts.length ? ' ' : ''}Every rating so far is 5★.` })
  } else if (high >= 0.6) {
    parts.push({ text: `${parts.length ? ' ' : ''}Generous with the stars: most ratings are 4★ or higher.` })
  } else if (low >= 0.4) {
    parts.push({ text: `${parts.length ? ' ' : ''}A tough crowd: plenty of 1★ and 2★ ratings.` })
  } else {
    parts.push({ text: `${parts.length ? ' ' : ''}Ratings spread across the scale, averaging ${avg}★.` })
  }
  return parts
}
