import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewConversation } from '@/components/conversations/ReviewConversation'
import { cardGlowStyle, useCoverColors } from '@/lib/coverColors'
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
  highlightCommentId = null,
  replyToCommentId = null,
  song,
}: {
  review: ReviewWithAuthor
  /** Arrived here from a notification — scroll to it and flash it once. */
  highlight?: boolean
  openComments?: boolean
  /** The comment a notification is about. */
  highlightCommentId?: string | null
  /** A notification's Reply: the box opens replying to this comment. */
  replyToCommentId?: string | null
  /** The song page's song, for the glow and the comments sheet. */
  song?: { id: string; title: string; artistName: string; coverUrl: string | null }
}) {
  const ref = useRef<HTMLElement>(null)
  const [flash, setFlash] = useState(false)
  const colors = useCoverColors(song?.coverUrl)

  useEffect(() => {
    if (!highlight) return
    // With a comment to show, that comment is what scrolls into view.
    if (!highlightCommentId) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(true)
    // Brief, then back to normal — a permanent highlight reads as a state.
    const t = setTimeout(() => setFlash(false), 2000)
    return () => clearTimeout(t)
  }, [highlight, highlightCommentId])

  const name = review.author?.displayName || review.author?.username || 'Someone'
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <article
      ref={ref}
      data-review-id={review.id}
      style={cardGlowStyle(colors)}
      className={cn(
        'flex scroll-mt-36 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors duration-500 ease-soft sm:p-5',
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

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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

      <ReviewConversation
        review={review}
        song={song ?? null}
        openComments={openComments}
        highlightCommentId={highlightCommentId}
        replyToCommentId={replyToCommentId}
      />
    </article>
  )
}
