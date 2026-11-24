import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { logError, logWarn } from '@/lib/log'

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
  leading,
}: {
  review: ReviewWithAuthor
  /** Shown first in the action row (the review's stars). */
  leading?: ReactNode
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
      .catch((err) => logWarn('comments', 'comment preview failed', { error: err }))
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
      logError('comments', 'like failed', { error: err })
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
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
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

  // Small icons, full 44px tap areas: the buttons overlap the row's
  // padding rather than adding to it.
  const action =
    'group/act flex min-h-11 min-w-11 items-center gap-1.5 rounded-chip px-2.5 text-[13px] font-semibold tabular-nums transition-colors duration-200 ease-soft'
  const actions = (
    <div className="-my-1 -ml-2.5 flex min-w-0 items-center gap-0.5">
      {leading && <span className="mr-1.5 flex shrink-0 items-center pl-2.5">{leading}</span>}
      <button
        type="button"
        onClick={() => void toggleLike()}
        aria-pressed={liked}
        aria-label={liked ? 'Unlike this review' : 'Like this review'}
        className={cn(action, liked ? 'text-like' : 'text-muted-foreground hover:text-like')}
      >
        <Heart
          className={cn(
            'size-[17px] transition-transform duration-200 ease-soft group-active/act:scale-90',
            liked && 'fill-like drop-shadow-[0_0_6px_rgb(244_114_182/0.55)]'
          )}
          strokeWidth={1.75}
        />
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
        className={cn(action, open && wide ? 'text-accent' : 'text-muted-foreground hover:text-accent')}
      >
        <MessageSquare className="size-[17px]" strokeWidth={1.75} />
        {(wide || count > 0) && (
          <span aria-hidden>{wide ? (count === 0 ? 'Comment' : commentCountLabel(count)) : count}</span>
        )}
      </button>
      <span className="ml-auto min-w-0 pl-1">{likedBy}</span>
    </div>
  )

  const top = preview?.topComment
  const otherCommenters = (preview?.commenters ?? []).filter((p) => p.id !== top?.userId).slice(0, 2)

  // Collapsed: the top comment and "View all" on a card with comments,
  // nothing more. The box to write in appears once the thread is open.
  const collapsed = top ? (
    <div className="flex flex-col">
      {top && (
        <div
          onClick={(e) => {
            // The names are links of their own.
            if (!(e.target as HTMLElement).closest('a, button')) openThread('read')
          }}
          className="flex cursor-pointer flex-col rounded-inset border border-line bg-white/[0.025] px-3 pt-2.5 transition-colors duration-200 ease-soft hover:border-line-strong"
        >
          <div className="flex gap-2.5">
            <Link to={`/profile/${top.userId}`} aria-hidden tabIndex={-1} className="shrink-0">
              <PersonAvatar
                name={personName({ displayName: top.author?.displayName ?? null, username: top.author?.username ?? null })}
                url={top.author?.avatarUrl}
                className="size-7 text-meta"
              />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <p className="flex w-full items-baseline gap-1.5">
                <Link
                  to={`/profile/${top.userId}`}
                  dir="auto"
                  className="truncate text-[13.5px] font-semibold transition-colors duration-200 ease-soft hover:text-accent"
                >
                  {top.author?.displayName || top.author?.username || 'Someone'}
                </Link>
                <span className="text-meta text-muted-foreground">{commentAge(top.createdAt, wide)}</span>
                {top.likeCount > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-meta tabular-nums text-like">
                    <Heart className="size-3.5 fill-like" strokeWidth={0} aria-hidden />
                    <span className="sr-only">Likes:</span>
                    {top.likeCount}
                  </span>
                )}
              </p>
              <div
                className={cn(
                  'w-full text-[14px] leading-[1.45] text-foreground/[0.85]',
                  // The review's author: a thin Primary line on the text's starting side.
                  top.isAuthor && 'border-s-2 border-primary/60 ps-2'
                )}
              >
                <CommentText body={top.body} mentions={top.mentions} className="line-clamp-2" />
              </div>
            </div>
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => openThread('read')}
              className="tap-44 ml-[38px] flex min-h-9 w-fit items-center gap-2 text-[13px] font-semibold text-accent transition-colors duration-200 ease-soft hover:text-foreground"
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
    <div className="flex flex-col gap-1.5 pb-2">
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
            <div className="flex flex-col gap-4 border-t border-line pb-2 pt-3">
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
