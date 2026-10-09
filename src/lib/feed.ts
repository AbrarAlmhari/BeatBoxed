import { supabase } from './supabase'
import { REVIEW_SELECT, toReviewModel, type ReviewRow } from './catalog'
import type { PersonCardModel, ReviewWithAuthor, SongCardModel } from './types'

/**
 * Home's review feed: For You and Following.
 *
 * Which reviews, in what order, and who may see them are all decided in the
 * database (0028's feed_for_you / feed_following, under the reviews RLS
 * policy). This file pages through those ids and turns them into cards.
 */

/**
 * The fewest characters of written review (the body, trimmed — the headline
 * doesn't count) for a review to appear in the feed. The composer's counter
 * and Post button use the same number, and it's passed to the database
 * functions rather than repeated there, so this is the one place to change
 * it. Shorter and star-only reviews still count in song averages and still
 * show on song pages.
 */
export const FEED_MIN_CHARS = 80

/** About a screenful at a time. */
export const FEED_PAGE_SIZE = 20

export type FeedTab = 'for-you' | 'following'

/** A review with the song it's about, enough to render a feed card and play it. */
export type FeedReview = ReviewWithAuthor & {
  song: SongCardModel
}

/**
 * Where the next page starts. For You pages by score with the time fixed at
 * the first load (so scores don't drift between pages); Following pages by
 * date. Both carry the id as a tiebreak.
 */
export type FeedCursor =
  | { tab: 'for-you'; asOf: string; score: number; id: string }
  | { tab: 'following'; at: string; id: string }

export type FeedPage = { items: FeedReview[]; next: FeedCursor | null }

function client() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

type Rel<T> = T | T[] | null
const one = <T,>(v: Rel<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

type FeedReviewRow = ReviewRow & {
  songs: Rel<{
    id: string
    title: string
    artist_id: string | null
    album_id: string | null
    artists: Rel<{ name: string }>
    albums: Rel<{ cover_url: string | null; title: string | null }>
  }>
}

const FEED_SELECT =
  REVIEW_SELECT +
  ', songs(id, title, artist_id, album_id, artists(name), albums(cover_url, title))'

/**
 * Turns an ordered list of review ids into cards, keeping that order. The
 * read goes through the reviews table, so RLS checks privacy a second time;
 * anything it withholds is simply dropped.
 */
async function hydrate(ids: string[], viewerId: string): Promise<FeedReview[]> {
  if (ids.length === 0) return []
  const c = client()

  const [rows, likes] = await Promise.all([
    c.from('reviews').select(FEED_SELECT).in('id', ids),
    c.from('review_likes').select('review_id').eq('user_id', viewerId).in('review_id', ids),
  ])
  if (rows.error) throw rows.error
  if (likes.error) throw likes.error

  const liked = new Set((likes.data ?? []).map((l) => l.review_id as string))
  const byId = new Map<string, FeedReview>()
  for (const row of (rows.data ?? []) as unknown as FeedReviewRow[]) {
    const song = one(row.songs)
    if (!song) continue
    byId.set(row.id, {
      ...toReviewModel(row, liked.has(row.id)),
      song: {
        id: song.id,
        title: song.title,
        artistName: one(song.artists)?.name ?? 'Unknown artist',
        artistId: song.artist_id,
        albumId: song.album_id,
        coverUrl: one(song.albums)?.cover_url ?? null,
        albumTitle: one(song.albums)?.title ?? null,
        // A feed card shows the review's rating, not the song's average.
        ratingAvg: null,
        reviewCount: 0,
      },
    })
  }
  return ids.flatMap((id) => byId.get(id) ?? [])
}

/** One page of a tab. Pass the previous page's `next` to continue. */
export async function getFeedPage(
  tab: FeedTab,
  viewerId: string,
  cursor: FeedCursor | null
): Promise<FeedPage> {
  const c = client()

  if (tab === 'following') {
    const after = cursor?.tab === 'following' ? cursor : null
    const { data, error } = await c.rpc('feed_following', {
      min_chars: FEED_MIN_CHARS,
      before_at: after?.at ?? null,
      before_id: after?.id ?? null,
      page_size: FEED_PAGE_SIZE,
    })
    if (error) throw error
    const rows = (data ?? []) as { review_id: string; created_at: string }[]
    const last = rows[rows.length - 1]
    return {
      items: await hydrate(rows.map((r) => r.review_id), viewerId),
      next:
        rows.length === FEED_PAGE_SIZE && last
          ? { tab: 'following', at: last.created_at, id: last.review_id }
          : null,
    }
  }

  const after = cursor?.tab === 'for-you' ? cursor : null
  // Fixed at the first page and carried through every later one.
  const asOf = after?.asOf ?? new Date().toISOString()
  const { data, error } = await c.rpc('feed_for_you', {
    min_chars: FEED_MIN_CHARS,
    as_of: asOf,
    after_score: after?.score ?? null,
    after_id: after?.id ?? null,
    page_size: FEED_PAGE_SIZE,
  })
  if (error) throw error
  const rows = (data ?? []) as { review_id: string; score: number }[]
  const last = rows[rows.length - 1]
  return {
    items: await hydrate(rows.map((r) => r.review_id), viewerId),
    next:
      rows.length === FEED_PAGE_SIZE && last
        ? { tab: 'for-you', asOf, score: last.score, id: last.review_id }
        : null,
  }
}

export type SuggestedReviewer = PersonCardModel & { reviewCount: number }

/** Public accounts that review often, for an empty Following tab. */
export async function getSuggestedReviewers(limit = 5): Promise<SuggestedReviewer[]> {
  const { data, error } = await client().rpc('suggested_reviewers', {
    min_chars: FEED_MIN_CHARS,
    max_count: limit,
  })
  if (error) throw error
  return (
    (data ?? []) as {
      id: string
      username: string | null
      display_name: string | null
      avatar_url: string | null
      review_count: number
    }[]
  ).map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    reviewCount: Number(r.review_count),
  }))
}

export const REPORT_REASONS = [
  'Spam',
  'Harassment or hate',
  'Spoilers or off-topic',
  'Something else',
] as const

/** Files a report. Reporting the same review twice counts as done. */
export async function reportReview(reporterId: string, reviewId: string, reason: string) {
  const { error } = await client()
    .from('review_reports')
    .insert({ reporter_id: reporterId, review_id: reviewId, reason })
  if (error && error.code !== '23505') throw error
}

/**
 * The viewer's own reviews for a set of songs, keyed by song id. Drives the
 * composer's "Reviewed" badge and opens an existing review for editing.
 */
export async function getMyReviews(
  userId: string,
  songIds: string[]
): Promise<Map<string, ReviewWithAuthor>> {
  const map = new Map<string, ReviewWithAuthor>()
  if (songIds.length === 0) return map
  const { data, error } = await client()
    .from('reviews')
    .select(`song_id, ${REVIEW_SELECT}`)
    .eq('user_id', userId)
    .in('song_id', songIds)
  if (error) throw error
  for (const row of (data ?? []) as unknown as (ReviewRow & { song_id: string })[]) {
    map.set(row.song_id, toReviewModel(row, false))
  }
  return map
}

/**
 * Counts toward FEED_MIN_CHARS the way the database does: the body, trimmed
 * (upsertReview stores it trimmed), in characters. Spread rather than
 * .length, because .length counts an emoji as two and Postgres's
 * char_length counts it as one — the composer would otherwise enable Post
 * for a review the feed then leaves out.
 */
export function feedLength(body: string) {
  return [...body.trim()].length
}
