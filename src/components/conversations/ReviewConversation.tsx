import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageSquare } from 'lucide-react'
import { CommentThread } from './CommentThread'
import { CommentsSheet } from './CommentsSheet'
import { CommentText } from './CommentText'
import { AvatarStack, PersonAvatar } from './PersonAvatar'
import { useAuth } from '@/lib/auth'
import { setReviewLike } from '@/lib/catalog'
import {
  commentAge,
  commentCountLabel,
  loadPreview,
  useMe,
  useWideLayout,
  type CommentPerson,
  type ReviewPreview,
} from '@/lib/conversations'
import { cn } from '@/lib/cn'
import type { ReviewWithAuthor } from '@/lib/types'

const personName = (p: Pick<CommentPerson, 'displayName' | 'username'>) =>
  p.displayName || p.username || 'Someone'

/**
 * Everything under a review: the like and comment pills, "Liked by", and
 * the conversation. Collapsed, it shows the top comment and "View all N
 * comments". The comment pill (or the preview) opens it with the box ready
 * to type in: a phone gets the comments sheet, desktop the thread inside
 * the card.
 *
 * Shared by the feed, the profile tabs and the song page, so comments
 * behave the same everywhere.
 */
export function ReviewConversation({
  review,
  song,
  openComments = false,
  highlightCommentId = null,
  replyToCommentId = null,
}: {
  review: ReviewWithAuthor
  /** For the sheet's song row. */
  song?: { id: string; title: string; artistName: string; coverUrl: string | null } | null
  /** From a notification: open the conversation straight away. */
  openComments?: boolean
  highlightCommentId?: string | null
  /** From a notification's Reply button: the box is ready, replying to this. */
  replyToCommentId?: string | null
}) {
  const { user } = useAuth()
  const me = useMe(user?.id)
  const wide = useWideLayout()

  const [liked, setLiked] = useState(review.likedByMe)
  const [likeCount, setLikeCount] = useState(review.likeCount)
  const [preview, setPreview] = useState<ReviewPreview | null>(null)
  const [count, setCount] = useState(review.commentCount)
  const [open, setOpen] = useState(openComments || !!highlightCommentId || !!replyToCommentId)
  // Opened by a tap. The comment pill means "I want to write": the box gets
  // the cursor, and on desktop the page scrolls to it. View all, View comment
  // and the preview mean "I want to read": desktop opens at the top of the
  // thread without the cursor; a phone's sheet focuses its box either way.
  // A notification link focuses nothing, so the keyboard doesn't cover the
  // highlighted comment.
  const [focusBox, setFocusBox] = useState(false)
  // An unsent new comment. Kept while the card is on screen, so closing the
  // sheet or the thread by accident loses nothing; sending clears it.
  const [draft, setDraft] = useState('')

  const refresh = useCallback(() => {
    loadPreview(review.id)
      .then((p) => {
        if (!p) return
        setPreview(p)
        setCount(p.commentCount)
      })
      .catch((err) => console.warn('[beatboxed] comment preview failed:', err))
  }, [review.id])

  useEffect(refresh, [refresh])

  async function toggleLike() {
    if (!user) return
    const next = !liked
    setLiked(next)
    setLikeCount((c) => c + (next ? 1 : -1))
    try {
      await setReviewLike(review.id, user.id, next)
      refresh()
    } catch (err) {
      console.error('[beatboxed] like failed:', err)
      setLiked(!next)
      setLikeCount((c) => c + (next ? -1 : 1))
    }
  }

  const authorName = review.author?.displayName || review.author?.username || 'Someone'
  const reviewAuthor = { name: authorName, avatarUrl: review.author?.avatarUrl ?? null }

  // "Liked by Toji + 1" on a phone; "Toji and Mo" on desktop when it's two.
  const likers = preview?.likers ?? []
  const first = likers[0]
  const others = Math.max(0, likeCount - 1)
  const likedBy = first ? (
    <span className="flex min-w-0 items-center gap-2 text-secondary text-muted-foreground">
      <AvatarStack
        people={likers.slice(0, 2).map((p) => ({ id: p.id, name: personName(p), avatarUrl: p.avatarUrl }))}
      />
      <span className="truncate">
        Liked by <span className="font-semibold text-foreground">{personName(first)}</span>
        {others > 0 &&
          (wide && others === 1 && likers[1] ? (
            <>
              {' '}
              and <span className="font-semibold text-foreground">{personName(likers[1])}</span>
            </>
          ) : (
            ` + ${others}`
          ))}
      </span>
    </span>
  ) : null

  function openThread(intent: 'write' | 'read') {
    setFocusBox(intent === 'write' || !wide)
    setOpen(true)
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggleLike()}
        aria-pressed={liked}
        aria-label={liked ? 'Unlike this review' : 'Like this review'}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-chip px-4 text-button transition-colors duration-200 ease-soft',
          liked ? 'bg-like/15 text-like' : 'bg-surface-2 text-muted-foreground hover:text-foreground'
        )}
      >
        <Heart className={cn('size-[18px]', liked && 'fill-like')} strokeWidth={1.75} />
        {likeCount > 0 && <span>{likeCount}</span>}
      </button>
      <button
        type="button"
        onClick={() => {
          if (open && wide) {
            setOpen(false)
            refresh()
          } else openThread('write')
        }}
        aria-expanded={open}
        aria-label={count === 0 ? 'Comments' : commentCountLabel(count)}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-chip px-4 text-button transition-colors duration-200 ease-soft',
          open && wide ? 'bg-primary/25 text-accent' : 'bg-surface-2 text-muted-foreground hover:text-foreground'
        )}
      >
        <MessageSquare className="size-[18px]" strokeWidth={1.75} />
        {(wide || count > 0) && (
          <span aria-hidden>{wide ? (count === 0 ? 'Comment' : commentCountLabel(count)) : count}</span>
        )}
      </button>
      <span className="ml-auto min-w-0">{likedBy}</span>
    </div>
  )

  const top = preview?.topComment
  const otherCommenters = (preview?.commenters ?? []).filter((p) => p.id !== top?.userId).slice(0, 2)

  // Collapsed: the top comment and "View all" on a card with comments,
  // nothing more. The box to write in appears once the thread is open.
  const collapsed = top ? (
    <div className="flex flex-col gap-3">
      {top && (
        <div
          onClick={(e) => {
            // The names are links of their own.
            if (!(e.target as HTMLElement).closest('a, button')) openThread('read')
          }}
          className="flex cursor-pointer flex-col gap-2 rounded-card border border-line bg-surface-2/40 p-3.5 transition-colors duration-200 ease-soft hover:border-line-strong"
        >
          <div className="flex gap-3">
            <Link to={`/profile/${top.userId}`} aria-hidden tabIndex={-1}>
              <PersonAvatar
                name={personName({ displayName: top.author?.displayName ?? null, username: top.author?.username ?? null })}
                url={top.author?.avatarUrl}
                className="size-9 text-secondary"
              />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <p className="flex w-full items-baseline gap-2">
                <Link
                  to={`/profile/${top.userId}`}
                  dir="auto"
                  className="truncate text-card-title transition-colors duration-200 ease-soft hover:text-accent"
                >
                  {top.author?.displayName || top.author?.username || 'Someone'}
                </Link>
                <span className="text-meta text-muted-foreground">{commentAge(top.createdAt, wide)}</span>
                {top.likeCount > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-secondary text-like">
                    <Heart className="size-4 fill-like" strokeWidth={0} aria-hidden />
                    <span className="sr-only">Likes:</span>
                    {top.likeCount}
                  </span>
                )}
              </p>
              <div
                className={cn(
                  'max-w-full rounded-[18px] px-3.5 py-2 text-body',
                  top.isAuthor ? 'bg-primary/20' : 'bg-surface-2'
                )}
              >
                <CommentText body={top.body} mentions={top.mentions} className="line-clamp-3" />
              </div>
            </div>
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => openThread('read')}
              className="ml-12 flex min-h-10 w-fit items-center gap-2 text-secondary font-semibold text-accent transition-colors duration-200 ease-soft hover:text-foreground"
            >
              <AvatarStack
                people={otherCommenters.map((p) => ({ id: p.id, name: personName(p), avatarUrl: p.avatarUrl }))}
              />
              {count === 1 ? 'View comment' : `View all ${commentCountLabel(count)}`}
            </button>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      {actions}

      {wide && open ? (
        <CommentThread
          reviewId={review.id}
          reviewAuthor={reviewAuthor}
          me={me}
          inlineReplies
          long
          highlightId={highlightCommentId}
          replyToId={replyToCommentId}
          focusComposer={focusBox}
          draft={draft}
          onDraftChange={setDraft}
          onCount={setCount}
        >
          {({ sort, list, composer }) => (
            <div className="-mx-4 flex flex-col gap-4 border-t border-line px-4 pt-4 sm:-mx-5 sm:px-5">
              {sort}
              {list}
              {composer}
            </div>
          )}
        </CommentThread>
      ) : (
        collapsed
      )}

      {!wide && (
        <CommentsSheet
          open={open}
          onClose={() => {
            setOpen(false)
            refresh()
          }}
          reviewId={review.id}
          count={count}
          song={song ?? null}
          reviewText={review.body}
          reviewAuthor={reviewAuthor}
          me={me}
          highlightId={highlightCommentId}
          replyToId={replyToCommentId}
          focusComposer={focusBox}
          draft={draft}
          onDraftChange={setDraft}
          onCount={setCount}
        />
      )}
    </div>
  )
}
