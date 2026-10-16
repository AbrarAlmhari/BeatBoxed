import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Comments, replies, likes on comments and @mentions (0043).
 *
 * Reads go through database functions so a thread, or the previews for a
 * whole page of cards, is one request: review_thread() and
 * review_previews(). Writes are plain inserts and deletes; the database
 * places replies, turns typed @names into stored mentions, keeps the
 * "Comment deleted" placeholder and sends the notifications.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export type CommentPerson = {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

export type MentionPerson = {
  id: string
  username: string | null
  displayName: string | null
}

export type ThreadComment = {
  id: string
  /** The top-level comment a reply sits under; null for a top-level one. */
  parentId: string | null
  replyToId: string | null
  /** Null on a "Comment deleted" placeholder. */
  userId: string | null
  author: Omit<CommentPerson, 'id'> | null
  /** Mentions are stored as <@user-id>; see commentSegments(). */
  body: string
  mentions: MentionPerson[]
  createdAt: string
  edited: boolean
  deleted: boolean
  likeCount: number
  likedByMe: boolean
  /** The review's author liked it: "Loved by author". */
  authorLiked: boolean
  replyCount: number
  /** Written by the review's author: the "Author" label. */
  isAuthor: boolean
}

export type ThreadEntry = ThreadComment & { replies: ThreadComment[] }

export type ThreadSort = 'top' | 'newest'

export type ReviewPreview = {
  reviewId: string
  /** Replies included, placeholders not. */
  commentCount: number
  topComment: ThreadComment | null
  /** Recent commenters, for the small avatars beside "View all". */
  commenters: CommentPerson[]
  /** The first people who liked the review, for "Liked by". */
  likers: CommentPerson[]
}

export type MentionReason = 'thread' | 'following' | 'follower' | null

export type MentionSuggestion = CommentPerson & { reason: MentionReason }

type PersonJson = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url?: string | null
}

const toPerson = (p: PersonJson): CommentPerson => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
  avatarUrl: p.avatar_url ?? null,
})

const toMention = (p: PersonJson): MentionPerson => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
})

type ThreadRow = {
  id: string
  parent_id: string | null
  reply_to_id: string | null
  user_id: string | null
  username: string | null
  display_name: string | null
  avatar_url: string | null
  body: string
  mentions: PersonJson[] | null
  created_at: string
  edited: boolean
  deleted: boolean
  like_count: number
  liked_by_me: boolean
  author_liked: boolean
  reply_count: number
  is_author: boolean
}

function toThreadComment(r: ThreadRow): ThreadComment {
  return {
    id: r.id,
    parentId: r.parent_id,
    replyToId: r.reply_to_id,
    userId: r.user_id,
    author: r.deleted
      ? null
      : { username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
    body: r.body,
    mentions: (r.mentions ?? []).map(toMention),
    createdAt: r.created_at,
    edited: r.edited,
    deleted: r.deleted,
    likeCount: r.like_count,
    likedByMe: r.liked_by_me,
    authorLiked: r.author_liked,
    replyCount: r.reply_count,
    isAuthor: r.is_author,
  }
}

/** The rows come top-level first, each followed by its replies. */
export function groupThread(rows: ThreadComment[]): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  const byId = new Map<string, ThreadEntry>()
  for (const c of rows) {
    if (c.parentId === null) {
      const entry = { ...c, replies: [] }
      entries.push(entry)
      byId.set(c.id, entry)
    } else {
      byId.get(c.parentId)?.replies.push(c)
    }
  }
  return entries
}

export async function getThread(reviewId: string, sort: ThreadSort): Promise<ThreadEntry[]> {
  const { data, error } = await requireClient().rpc('review_thread', {
    target_review: reviewId,
    sort,
  })
  if (error) throw error
  return groupThread(((data ?? []) as ThreadRow[]).map(toThreadComment))
}

type PreviewRow = {
  review_id: string
  comment_count: number
  top_comment: (PersonJson & {
    user_id: string
    body: string
    mentions: PersonJson[] | null
    created_at: string
    like_count: number
    liked_by_me: boolean
    is_author: boolean
  }) | null
  commenters: PersonJson[] | null
  likers: PersonJson[] | null
}

export async function getPreviews(reviewIds: string[]): Promise<Map<string, ReviewPreview>> {
  const out = new Map<string, ReviewPreview>()
  if (reviewIds.length === 0) return out
  const { data, error } = await requireClient().rpc('review_previews', {
    target_reviews: reviewIds,
  })
  if (error) throw error
  for (const r of (data ?? []) as PreviewRow[]) {
    const t = r.top_comment
    out.set(r.review_id, {
      reviewId: r.review_id,
      commentCount: r.comment_count,
      topComment: t
        ? {
            id: t.id,
            parentId: null,
            replyToId: null,
            userId: t.user_id,
            author: { username: t.username, displayName: t.display_name, avatarUrl: t.avatar_url ?? null },
            body: t.body,
            mentions: (t.mentions ?? []).map(toMention),
            createdAt: t.created_at,
            edited: false,
            deleted: false,
            likeCount: t.like_count,
            likedByMe: t.liked_by_me,
            authorLiked: false,
            replyCount: 0,
            isAuthor: t.is_author,
          }
        : null,
      commenters: (r.commenters ?? []).map(toPerson),
      likers: (r.likers ?? []).map(toPerson),
    })
  }
  return out
}

/**
 * One card's preview. Every card on a page asks during the same render, so
 * the asks are collected for a moment and sent as one review_previews()
 * request instead of one each.
 */
let pending: { ids: Set<string>; done: Promise<Map<string, ReviewPreview>> } | null = null

export function loadPreview(reviewId: string): Promise<ReviewPreview | null> {
  if (!pending) {
    const ids = new Set<string>()
    const done = new Promise<Map<string, ReviewPreview>>((resolve, reject) => {
      setTimeout(() => {
        pending = null
        getPreviews([...ids]).then(resolve, reject)
      }, 0)
    })
    pending = { ids, done }
  }
  pending.ids.add(reviewId)
  return pending.done.then((m) => m.get(reviewId) ?? null)
}

/**
 * Posts a comment, or a reply when replyToId is given (the database puts a
 * reply to a reply under the same top-level comment). Typed @names become
 * mentions on the way in.
 */
export async function postComment(
  reviewId: string,
  userId: string,
  body: string,
  replyToId: string | null = null
) {
  const { data, error } = await requireClient()
    .from('review_comments')
    .insert({ review_id: reviewId, user_id: userId, body: body.trim(), reply_to_id: replyToId })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Deletes your comment. With replies under it, the database keeps a
 * "Comment deleted" placeholder so the replies keep their place.
 */
export async function deleteComment(commentId: string, userId: string) {
  // RLS scopes this to the author already; the filter keeps it that way if
  // a policy ever regresses.
  const { error } = await requireClient()
    .from('review_comments')
    .delete()
    .eq('id', commentId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function setCommentLike(commentId: string, userId: string, liked: boolean) {
  const client = requireClient()
  if (liked) {
    const { error } = await client
      .from('comment_likes')
      .insert({ comment_id: commentId, user_id: userId })
    // A double tap racing itself: already liked is success.
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await client
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

export async function getMentionSuggestions(
  reviewId: string,
  query: string
): Promise<MentionSuggestion[]> {
  const { data, error } = await requireClient().rpc('mention_suggestions', {
    target_review: reviewId,
    query,
    max_results: 5,
  })
  if (error) throw error
  return ((data ?? []) as (PersonJson & { reason: MentionReason })[]).map((p) => ({
    ...toPerson(p),
    reason: p.reason,
  }))
}

/* ---------------------------------------------------------------- text */

export type CommentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; person: MentionPerson }

const MENTION_TOKEN = /<@([0-9a-f-]{36})>/g

/**
 * Splits stored text into plain text and mentions. A mention shows the
 * person's current @username; one whose account is gone shows as plain
 * "@someone".
 */
export function commentSegments(body: string, mentions: MentionPerson[]): CommentSegment[] {
  const people = new Map(mentions.map((m) => [m.id, m]))
  const out: CommentSegment[] = []
  let last = 0
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const at = match.index ?? 0
    if (at > last) out.push({ kind: 'text', text: body.slice(last, at) })
    const person = people.get(match[1])
    out.push(
      person?.username
        ? { kind: 'mention', person }
        : { kind: 'text', text: '@someone' }
    )
    last = at + match[0].length
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) })
  return out
}

/** Plain text for a quote or a preview: mentions as @username. */
export function plainCommentText(body: string, mentions: MentionPerson[]) {
  return commentSegments(body, mentions)
    .map((s) => (s.kind === 'text' ? s.text : `@${s.person.username}`))
    .join('')
}

/** "@name " for a reply to a reply, so the conversation reads naturally. */
export function replyPrefix(username: string | null | undefined) {
  return username ? `@${username} ` : ''
}

/** "5 comments", "1 comment". */
export function commentCountLabel(n: number) {
  return `${n} ${n === 1 ? 'comment' : 'comments'}`
}

/* -------------------------------------------------------------- layout */

const WIDE = '(min-width: 768px)'

/**
 * Desktop or phone, matching where the app shell swaps the bottom bar for
 * the sidebar. Phones open comments in a sheet; desktop keeps the thread
 * inside the card.
 */
export function useWideLayout() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE).matches
  )
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/** "2w" on a phone, "2 weeks ago" on desktop, as in the mockups. */
export function commentAge(iso: string, long: boolean, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const steps: [number, number, string, string][] = [
    [3600, 60, 'm', 'minute'],
    [86400, 3600, 'h', 'hour'],
    [604800, 86400, 'd', 'day'],
    [2629800, 604800, 'w', 'week'],
    [31557600, 2629800, 'mo', 'month'],
  ]
  if (s < 60) return long ? 'just now' : 'now'
  for (const [limit, per, short, word] of steps) {
    if (s < limit) {
      const n = Math.floor(s / per)
      return long ? `${n} ${word}${n === 1 ? '' : 's'} ago` : `${n}${short}`
    }
  }
  const years = Math.floor(s / 31557600)
  return long ? `${years} year${years === 1 ? '' : 's'} ago` : `${years}y`
}

/* ------------------------------------------------------------------ me */

const meCache = new Map<string, Promise<{ name: string; avatarUrl: string | null }>>()

/**
 * The signed-in person's name and picture for the comment boxes. Every card
 * on a page needs it, so it's read once per session rather than per card.
 */
export function useMe(userId: string | undefined) {
  const [me, setMe] = useState<{ name: string; avatarUrl: string | null }>({ name: '', avatarUrl: null })
  useEffect(() => {
    if (!userId) return
    let hit = meCache.get(userId)
    if (!hit) {
      hit = (async () => {
        const { data } = await requireClient()
          .from('profiles')
          .select('display_name, username, avatar_url')
          .eq('id', userId)
          .maybeSingle()
        const p = data as { display_name: string | null; username: string | null; avatar_url: string | null } | null
        return { name: p?.display_name || p?.username || '', avatarUrl: p?.avatar_url ?? null }
      })()
      meCache.set(userId, hit)
      hit.catch(() => meCache.delete(userId))
    }
    let live = true
    void hit.then((m) => live && setMe(m)).catch(() => {})
    return () => {
      live = false
    }
  }, [userId])
  return me
}
