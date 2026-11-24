import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, MoreHorizontal } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Sheet } from '@/components/ui/Sheet'
import { ReviewConversation } from '@/components/conversations/ReviewConversation'
import { MuteConfirm, type MuteTarget } from '@/components/mutes/MuteConfirm'
import { useAuth } from '@/lib/auth'
import { useMutedIds } from '@/lib/mutes'
import { cn } from '@/lib/cn'
import {
  ReviewAvatar,
  ReviewByline,
  reviewBodyClass,
  reviewRowClass,
} from '@/components/feed/FeedCard'
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

  if (muted && !isOwn) return null

  return (
    <article
      ref={ref}
      data-review-id={review.id}
      className={cn(reviewRowClass, flash && 'bg-primary/[0.09]')}
    >
      <Link to={`/profile/${review.userId}`} className="shrink-0" aria-hidden tabIndex={-1}>
        <ReviewAvatar name={name} url={review.author?.avatarUrl} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="-my-1.5 flex min-h-8 items-center gap-1.5">
            <ReviewByline
              href={`/profile/${review.userId}`}
              name={name}
              meta={
                <>
                  {review.author?.username && `@${review.author.username} · `}
                  {dateFmt.format(new Date(review.createdAt))}
                  {review.edited && ' · edited'}
                </>
              }
            />
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
            <p dir="auto" className="w-full text-[15px] font-semibold leading-snug">
              {review.title}
            </p>
          )}

          {review.body && (
            <p dir="auto" className={reviewBodyClass}>
              {review.body}
            </p>
          )}

        <div className="mt-1">
          <ReviewConversation
            review={review}
            song={song ?? null}
            openComments={openComments}
            highlightCommentId={highlightCommentId}
            replyToCommentId={replyToCommentId}
            leading={<StarRating value={review.rating} size={13} />}
          />
        </div>
      </div>
    </article>
  )
}

/** "⋯" on someone else's review on the song page: Mute. */
function ReviewCardMenu({ person }: { person: MuteTarget }) {
  const [open, setOpen] = useState(false)
  const [muting, setMuting] = useState<MuteTarget | null>(null)
  const handle = person.username ? `@${person.username}` : person.name
  return (
    <div className="relative -my-1.5 -mr-3 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Review options"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground"
      >
        <MoreHorizontal className="size-[17px]" strokeWidth={1.75} />
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
