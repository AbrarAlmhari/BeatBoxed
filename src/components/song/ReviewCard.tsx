import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Heart, MessageCircle } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewComments } from './ReviewComments'
import { useAuth } from '@/lib/auth'
import { setReviewLike } from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { ReviewWithAuthor } from '@/lib/types'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function ReviewCard({
  review,
  highlight = false,
  openComments = false,
}: {
  review: ReviewWithAuthor
  /** Arrived here from a notification — scroll to it and flash it once. */
  highlight?: boolean
  openComments?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!highlight) return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(true)
    // Brief, then back to normal — a permanent highlight reads as a state.
    const t = setTimeout(() => setFlash(false), 2000)
    return () => clearTimeout(t)
  }, [highlight])

  const name = review.author?.displayName || review.author?.username || 'Someone'
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <article
      ref={ref}
      className={cn(
        'flex scroll-mt-36 flex-col gap-3 rounded-card bg-surface p-4 shadow-card transition-colors duration-500 ease-soft',
        flash && 'ring-2 ring-primary/60'
      )}
    >
      <div className="flex gap-3">
        <Link to={`/profile/${review.userId}`} className="shrink-0">
          {review.author?.avatarUrl ? (
            <img
            src={review.author.avatarUrl}
            alt=""
            loading="lazy"
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
              {initial}
            </span>
          )}
        </Link>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={`/profile/${review.userId}`}
              className="text-card-title transition-colors duration-200 ease-soft hover:text-accent"
            >
              {name}
            </Link>
            <StarRating value={review.rating} size={14} />
            <span className="text-meta text-muted-foreground">
              {dateFmt.format(new Date(review.createdAt))}
              {review.edited && ' · edited'}
            </span>
          </div>

          {review.title && (
            <p dir="auto" className="text-card-title">
              {review.title}
            </p>
          )}

          {review.body && (
            <p dir="auto" className="text-body text-muted-foreground">
              {review.body}
            </p>
          )}
        </div>
      </div>

      <ReviewActions review={review} openComments={openComments} className="pl-13" />
    </article>
  )
}

/**
 * Like and comment, shared by the song page's ReviewCard and the feed's
 * FeedCard so both behave identically.
 *
 * Like and comment counts are owned locally after first interaction so the
 * card stays responsive without re-fetching the list it sits in.
 */
export function ReviewActions({
  review,
  openComments = false,
  className,
}: {
  review: ReviewWithAuthor
  openComments?: boolean
  className?: string
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [liked, setLiked] = useState(review.likedByMe)
  const [likeCount, setLikeCount] = useState(review.likeCount)
  const [commentCount, setCommentCount] = useState(review.commentCount)
  const [commentsOpen, setCommentsOpen] = useState(openComments)

  function requireLogin() {
    navigate('/login', { state: { from: location.pathname } })
  }

  async function toggleLike() {
    if (!user) return requireLogin()

    const nextLiked = !liked
    setLiked(nextLiked)
    setLikeCount((c) => c + (nextLiked ? 1 : -1))

    try {
      await setReviewLike(review.id, user.id, nextLiked)
    } catch (err) {
      console.error('[beatboxed] like failed:', err)
      setLiked(!nextLiked)
      setLikeCount((c) => c + (nextLiked ? -1 : 1))
    }
  }

  return (
    <>
      {/* Secondary actions: quieter than the rating and body above them. */}
      <div className={cn('flex items-center gap-1', className)}>
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike this review' : 'Like this review'}
          className={cn(
            'flex items-center gap-1.5 rounded-button px-2 py-1 text-meta transition-colors duration-200 ease-soft',
            liked
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Heart
            className={cn('size-4', liked && 'fill-primary')}
            strokeWidth={1.75}
          />
          {likeCount > 0 && likeCount}
        </button>

        <button
          type="button"
          onClick={() => setCommentsOpen((v) => !v)}
          aria-expanded={commentsOpen}
          className="flex items-center gap-1.5 rounded-button px-2 py-1 text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          <MessageCircle className="size-4" strokeWidth={1.75} />
          {commentCount === 0
            ? 'Comment'
            : `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
        </button>
      </div>

      {commentsOpen && (
        <ReviewComments
          reviewId={review.id}
          onCountChange={(delta) => setCommentCount((c) => Math.max(0, c + delta))}
        />
      )}
    </>
  )
}
