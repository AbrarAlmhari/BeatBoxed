import { supabase } from './supabase'
import { FEED_SELECT, likedByViewer, toFeedReview, type FeedReview, type FeedReviewRow } from './feed'

/**
 * Reads for the profile page's tabs. Privacy is the database's: every read
 * goes through the reviews (and playlists) RLS policies, which call
 * can_view_profile(), so a private account's rows come back only to its
 * accepted followers.
 */

function client() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export const PROFILE_PAGE_SIZE = 20

/** written: has a headline or a body. ratings: stars only. */
export type ReviewFilter = 'all' | 'written' | 'ratings'
export type ReviewSortKey = 'recent' | 'highest' | 'liked'

/** Most liked can't be ordered by the database; this many are sorted here. */
const MOST_LIKED_CAP = 500

type Filterable = {
  or: (filters: string) => Filterable
  is: (column: string, value: null) => Filterable
}

function applyFilter<T extends Filterable>(q: T, filter: ReviewFilter): T {
  if (filter === 'written') return q.or('body.not.is.null,title.not.is.null') as T
  if (filter === 'ratings') return q.is('body', null).is('title', null) as T
  return q
}

/** True when a review has any written text. */
export function isWritten(r: { title: string | null; body: string | null }) {
  return Boolean(r.title?.trim() || r.body?.trim())
}

/**
 * One page of someone's reviews, as feed cards (with like and comment
 * counts and the viewer's like state).
 *
 * Recent and highest page in the database. Most liked has to count likes
 * first, which the database can't order by here, so it reads up to
 * MOST_LIKED_CAP reviews once and pages through them in memory; pass the
 * returned `all` back as `cachedAll` for later pages.
 */
export async function getProfileReviews(
  userId: string,
  viewerId: string,
  opts: { filter: ReviewFilter; sort: ReviewSortKey; offset: number; cachedAll?: FeedReview[] }
): Promise<{ items: FeedReview[]; hasMore: boolean; all?: FeedReview[] }> {
  const { filter, sort, offset } = opts

  if (sort === 'liked') {
    let all = opts.cachedAll
    if (!all) {
      const q = applyFilter(
        client().from('reviews').select(FEED_SELECT).eq('user_id', userId),
        filter
      )
        .order('created_at', { ascending: false })
        .limit(MOST_LIKED_CAP)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as unknown as FeedReviewRow[]
      const liked = await likedByViewer(rows.map((r) => r.id), viewerId)
      all = rows
        .flatMap((r) => toFeedReview(r, liked.has(r.id)) ?? [])
        // Ties keep newest first, as read.
        .sort((a, b) => b.likeCount - a.likeCount)
    }
    const items = all.slice(offset, offset + PROFILE_PAGE_SIZE)
    return { items, hasMore: offset + items.length < all.length, all }
  }

  let q = applyFilter(client().from('reviews').select(FEED_SELECT).eq('user_id', userId), filter)
  if (sort === 'highest') q = q.order('rating', { ascending: false })
  q = q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PROFILE_PAGE_SIZE - 1)
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as unknown as FeedReviewRow[]
  const liked = await likedByViewer(rows.map((r) => r.id), viewerId)
  const items = rows.flatMap((r) => toFeedReview(r, liked.has(r.id)) ?? [])
  return { items, hasMore: rows.length === PROFILE_PAGE_SIZE }
}

/**
 * How many of someone's reviews have written text. Counted through RLS, so
 * it's only meaningful when the viewer can see the reviews; a locked private
 * profile doesn't show this number (see TASKS.md).
 */
export async function getWrittenReviewCount(userId: string): Promise<number> {
  const { count, error } = await applyFilter(
    client().from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    'written'
  )
  if (error) throw error
  return count ?? 0
}

/**
 * Reviews this person liked, newest like first. Reviews by private accounts
 * the viewer can't see are left out by RLS, so a page can hold fewer cards
 * than likes read: `read` is how many likes this page covered, which is
 * what the next page's offset has to advance by.
 */
export async function getLikedReviews(
  userId: string,
  viewerId: string,
  offset: number
): Promise<{ items: FeedReview[]; hasMore: boolean; read: number }> {
  const { data, error } = await client()
    .from('review_likes')
    .select('review_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + PROFILE_PAGE_SIZE - 1)
  if (error) throw error
  const ids = (data ?? []).map((r) => r.review_id as string)
  if (ids.length === 0) return { items: [], hasMore: false, read: 0 }

  const [rows, liked] = await Promise.all([
    client().from('reviews').select(FEED_SELECT).in('id', ids),
    likedByViewer(ids, viewerId),
  ])
  if (rows.error) throw rows.error
  const byId = new Map<string, FeedReview>()
  for (const row of (rows.data ?? []) as unknown as FeedReviewRow[]) {
    const card = toFeedReview(row, liked.has(row.id))
    if (card) byId.set(row.id, card)
  }
  return {
    items: ids.flatMap((id) => byId.get(id) ?? []),
    hasMore: ids.length === PROFILE_PAGE_SIZE,
    read: ids.length,
  }
}
