import { supabase } from './supabase'
import type {
  ArtistCardModel,
  LyricMatch,
  SearchMode,
  SearchResults,
  SongCardModel,
} from './types'

/**
 * Every read the Home and Explore screens make. Replaces the old mockData.ts —
 * catalog rows are cached into our own tables by the spotify-search Edge
 * Function, so the UI only ever sees our schema, never Spotify's payload.
 */

/**
 * PostgREST returns a single object for a many-to-one embed, but supabase-js
 * types it as an array. Accept both and normalise with one().
 */
type Rel<T> = T | T[] | null
const one = <T,>(v: Rel<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

type SongRow = {
  id: string
  title: string
  genre: string | null
  artist_id: string
  artists: Rel<{ name: string }>
  albums: Rel<{ cover_url: string | null }>
}

const SONG_SELECT = 'id, title, genre, artist_id, artists(name), albums(cover_url)'

function toCardModel(
  row: SongRow,
  stats?: { avg: number | null; count: number }
): SongCardModel {
  return {
    id: row.id,
    title: row.title,
    artistName: one(row.artists)?.name ?? 'Unknown artist',
    coverUrl: one(row.albums)?.cover_url ?? null,
    ratingAvg: stats?.avg ?? null,
    reviewCount: stats?.count ?? 0,
  }
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/**
 * Review aggregates for a set of songs. Postgres could do this in one grouped
 * query via a view, but the schema is locked for Week 1 — aggregating a single
 * fetched page client-side avoids a migration for now.
 */
async function ratingsFor(songIds: string[]) {
  const stats = new Map<string, { avg: number | null; count: number }>()
  if (songIds.length === 0) return stats

  const { data, error } = await requireClient()
    .from('reviews')
    .select('song_id, rating')
    .in('song_id', songIds)
  if (error) throw error

  const buckets = new Map<string, number[]>()
  for (const r of data ?? []) {
    const list = buckets.get(r.song_id) ?? []
    list.push(r.rating)
    buckets.set(r.song_id, list)
  }
  for (const [songId, ratings] of buckets) {
    stats.set(songId, {
      avg: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      count: ratings.length,
    })
  }
  return stats
}

async function decorate(rows: SongRow[]): Promise<SongCardModel[]> {
  const stats = await ratingsFor(rows.map((r) => r.id))
  return rows.map((r) => toCardModel(r, stats.get(r.id)))
}

export type HomeFeed = {
  continueListening: SongCardModel[]
  trending: SongCardModel[]
  forYou: SongCardModel[]
}

/**
 * Trending has two modes and picks between them on its own:
 *
 *  - No reviews anywhere yet -> newest cached songs, so a freshly seeded
 *    catalog still fills the rail.
 *  - Any reviews exist -> rank those songs by review count, then average
 *    rating, and top up with newest-cached only if there aren't enough.
 *
 * Nothing is hardcoded to one mode; as reviews accumulate the ranked portion
 * naturally grows and pushes the recency backfill out.
 */
async function fetchNewestCached(limit: number, excludeIds: string[] = []) {
  const { data, error } = await requireClient()
    .from('songs')
    .select(SONG_SELECT)
    .order('cached_at', { ascending: false })
    .limit(limit + excludeIds.length)
  if (error) throw error

  const skip = new Set(excludeIds)
  return ((data ?? []) as unknown as SongRow[])
    .filter((r) => !skip.has(r.id))
    .slice(0, limit)
}

async function fetchTrending(limit = 12): Promise<SongCardModel[]> {
  const { data: reviewRows, error: reviewErr } = await requireClient()
    .from('reviews')
    .select('song_id, rating')
  if (reviewErr) throw reviewErr

  const agg = new Map<string, { sum: number; count: number }>()
  for (const r of reviewRows ?? []) {
    const cur = agg.get(r.song_id) ?? { sum: 0, count: 0 }
    cur.sum += r.rating
    cur.count += 1
    agg.set(r.song_id, cur)
  }

  // Mode 1: nothing reviewed yet.
  if (agg.size === 0) return decorate(await fetchNewestCached(limit))

  // Mode 2: rank what has been reviewed.
  const rankedIds = [...agg.entries()]
    .sort(
      (a, b) =>
        b[1].count - a[1].count || b[1].sum / b[1].count - a[1].sum / a[1].count
    )
    .slice(0, limit)
    .map(([songId]) => songId)

  const { data: rankedRows, error: rankedErr } = await requireClient()
    .from('songs')
    .select(SONG_SELECT)
    .in('id', rankedIds)
  if (rankedErr) throw rankedErr

  const ordered = rankedIds
    .map((id) => (rankedRows as unknown as SongRow[]).find((r) => r.id === id))
    .filter((r): r is SongRow => Boolean(r))

  if (ordered.length >= limit) return decorate(ordered)

  const backfill = await fetchNewestCached(
    limit - ordered.length,
    ordered.map((r) => r.id)
  )
  return decorate([...ordered, ...backfill])
}

export async function getHomeFeedData(userId?: string): Promise<HomeFeed> {
  const client = requireClient()
  const trending = await fetchTrending()

  // No play-history table exists in docs/data-model.md, so this stays empty
  // rather than being faked with arbitrary songs.
  const continueListening: SongCardModel[] = []

  let forYou: SongCardModel[] = []
  if (userId) {
    const { data: follows, error: followErr } = await client
      .from('follows')
      .select('artist_id')
      .eq('user_id', userId)
    if (followErr) throw followErr

    const artistIds = (follows ?? []).map((f) => f.artist_id)
    if (artistIds.length > 0) {
      const { data, error } = await client
        .from('songs')
        .select(SONG_SELECT)
        .in('artist_id', artistIds)
        .limit(12)
      if (error) throw error
      forYou = await decorate((data ?? []) as unknown as SongRow[])
    }
  }

  // Following nobody yet — Trending is the honest fallback.
  if (forYou.length === 0) forYou = trending

  return { continueListening, trending, forYou }
}

/** Distinct genres actually present in the cached catalog. */
export async function getGenres(): Promise<string[]> {
  const { data, error } = await requireClient()
    .from('songs')
    .select('genre')
    .not('genre', 'is', null)
  if (error) throw error

  return [...new Set((data ?? []).map((r) => r.genre as string))].sort()
}

export const popularSearches = [
  'Radiohead',
  'dream pop',
  'Fairuz',
  'Tame Impala',
  'lo-fi',
  'Amr Diab',
]

/** Below this many local hits, reach out to Spotify and cache more. */
const REMOTE_TOPUP_THRESHOLD = 5

async function localSongs(query: string, genre: string | null) {
  let q = requireClient().from('songs').select(SONG_SELECT).limit(40)
  if (genre) q = q.eq('genre', genre)
  if (query) q = q.ilike('title', `%${query}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as SongRow[]
}

async function localArtists(query: string, genre: string | null) {
  let q = requireClient()
    .from('artists')
    .select('id, name, image_url, genres')
    .limit(40)
  if (genre) q = q.contains('genres', [genre])
  if (query) q = q.ilike('name', `%${query}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(
    (a): ArtistCardModel => ({
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      genres: a.genres ?? [],
    })
  )
}

/** Fire the cache-fill Edge Function; failures are non-fatal (local results still render). */
async function topUpFromSpotify(query: string, type: 'track' | 'artist') {
  try {
    const { error } = await requireClient().functions.invoke('spotify-search', {
      body: { q: query, type },
    })
    if (error) console.warn('[beatboxed] spotify-search failed:', error.message)
    return !error
  } catch (err) {
    console.warn('[beatboxed] spotify-search unreachable:', err)
    return false
  }
}

/**
 * Local-first: query our cache, and only reach for Spotify when the cache is
 * thin. The single place search behaviour lives.
 */
export async function searchCatalog(
  query: string,
  mode: SearchMode,
  genre: string | null
): Promise<SearchResults> {
  const trimmed = query.trim()

  if (mode === 'artists') {
    let artists = await localArtists(trimmed, genre)
    if (trimmed && artists.length < REMOTE_TOPUP_THRESHOLD) {
      if (await topUpFromSpotify(trimmed, 'artist')) {
        artists = await localArtists(trimmed, genre)
      }
    }
    return { mode: 'artists', artists }
  }

  let rows = await localSongs(trimmed, genre)
  if (trimmed && rows.length < REMOTE_TOPUP_THRESHOLD) {
    if (await topUpFromSpotify(trimmed, 'track')) {
      rows = await localSongs(trimmed, genre)
    }
  }

  if (mode === 'lyrics') {
    // lrclib matches a specific track, so lyrics search means: find candidate
    // songs, then ask lyrics-lookup for each and keep the lines that match.
    const lyrics: LyricMatch[] = []
    if (!trimmed) return { mode: 'lyrics', lyrics }

    const client = requireClient()
    const candidates = rows.slice(0, 8)
    const lookups = await Promise.all(
      candidates.map(async (row) => {
        try {
          const { data } = await client.functions.invoke('lyrics-lookup', {
            body: { artist: one(row.artists)?.name ?? '', track: row.title },
          })
          return { row, data }
        } catch {
          return { row, data: null }
        }
      })
    )

    const needle = trimmed.toLowerCase()
    for (const { row, data } of lookups) {
      const plain: string | null = data?.plainLyrics ?? null
      if (!plain) continue
      for (const line of plain.split('\n')) {
        if (line.toLowerCase().includes(needle)) {
          lyrics.push({
            songId: row.id,
            songTitle: row.title,
            artistName: one(row.artists)?.name ?? 'Unknown artist',
            line: line.trim(),
          })
        }
      }
    }
    return { mode: 'lyrics', lyrics }
  }

  return { mode: 'songs', songs: await decorate(rows) }
}
