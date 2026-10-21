import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, MoreHorizontal } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Sheet } from '@/components/ui/Sheet'
import { ReviewConversation } from '@/components/conversations/ReviewConversation'
import { MuteConfirm, type MuteTarget } from '@/components/mutes/MuteConfirm'
import { useAuth } from '@/lib/auth'
import { useMutedIds } from '@/lib/mutes'
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
  const { user } = useAuth()
  const isOwn = user?.id === review.userId
  // Someone you muted: their review isn't listed (their own profile still
  // shows it).
  const muted = useMutedIds(user?.id).has(review.userId)

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

  if (muted && !isOwn) return null

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
              dir="auto"
              className="min-w-0 text-card-title transition-colors duration-200 ease-soft hover:text-accent"
            >
              {name}
            </Link>
            <StarRating value={review.rating} size={14} />
            <span className="text-meta text-muted-foreground">
              {dateFmt.format(new Date(review.createdAt))}
              {review.edited && ' · edited'}
            </span>
            {!isOwn && user && (
              <ReviewCardMenu
                person={{
                  id: review.userId,
                  username: review.author?.username ?? null,
                  name,
                  avatarUrl: review.author?.avatarUrl ?? null,
                }}
              />
            )}
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

/** "⋯" on someone else's review on the song page: Mute. */
function ReviewCardMenu({ person }: { person: MuteTarget }) {
  const [open, setOpen] = useState(false)
  const [muting, setMuting] = useState<MuteTarget | null>(null)
  const handle = person.username ? `@${person.username}` : person.name
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Review options"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="-my-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground"
      >
        <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Review options" className="sm:w-56">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setMuting(person)
          }}
          className="flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body hover:bg-white/5"
        >
          <BellOff className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          Mute {handle}
        </button>
      </Sheet>
      <MuteConfirm target={muting} onClose={() => setMuting(null)} />
    </div>
  )
}
