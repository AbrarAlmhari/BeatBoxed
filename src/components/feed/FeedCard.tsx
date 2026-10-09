import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MoreHorizontal, Pause, Play } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Sheet } from '@/components/ui/Sheet'
import { Modal } from '@/components/ui/Modal'
import { ReviewActions } from '@/components/song/ReviewCard'
import { Artwork } from './Artwork'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { deleteReview } from '@/lib/catalog'
import { REPORT_REASONS, reportReview, type FeedReview } from '@/lib/feed'
import { cn } from '@/lib/cn'

/** "just now", "5m", "3h", "2d", then a date. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(iso)
  )
}

/**
 * One review in the feed: the song it's about on top, then who wrote it and
 * what they said. Like and comment are the song page's own (ReviewActions),
 * so they behave the same in both places.
 */
export function FeedCard({
  review,
  highlight = false,
  onDeleted,
}: {
  review: FeedReview
  /** Just posted: outline it briefly so the eye finds it. */
  highlight?: boolean
  onDeleted: (review: FeedReview) => void
}) {
  const { user } = useAuth()
  const player = usePlayer()
  const ref = useRef<HTMLElement>(null)
  const [flash, setFlash] = useState(highlight)

  useEffect(() => {
    if (!highlight) return
    setFlash(true)
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // Brief, then back to normal — a permanent outline reads as a state.
    const t = setTimeout(() => setFlash(false), 2500)
    return () => clearTimeout(t)
  }, [highlight])

  const { song } = review
  const isCurrent = player.current?.id === song.id
  const isPlaying = isCurrent && player.isPlaying
  const name = review.author?.displayName || review.author?.username || 'Someone'
  const isOwn = user?.id === review.userId

  return (
    <article
      ref={ref}
      data-review-id={review.id}
      data-highlighted={flash || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card transition-shadow duration-500 ease-soft',
        flash && 'ring-2 ring-primary/70'
      )}
    >
      {/* The song. Artwork and title open its page; the artist opens theirs. */}
      <div className="flex items-center gap-3 rounded-[12px] bg-surface-2 p-2.5">
        <Link to={`/song/${song.id}`} aria-hidden tabIndex={-1} className="shrink-0">
          <Artwork src={song.coverUrl} seed={song.id} className="size-14" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to={`/song/${song.id}`}
            dir="auto"
            className="truncate text-card-title transition-colors duration-200 ease-soft hover:text-accent"
          >
            {song.title}
          </Link>
          {song.artistId ? (
            <Link
              to={`/artist/${song.artistId}`}
              className="w-fit max-w-full truncate text-secondary text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
            >
              {song.artistName}
            </Link>
          ) : (
            <span className="truncate text-secondary text-muted-foreground">
              {song.artistName}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => (isCurrent ? player.toggle() : player.playQueue([song], 0))}
          aria-label={isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95"
        >
          {isCurrent && player.loading ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={2.25} />
          ) : isPlaying ? (
            <Pause className="size-4 fill-current" strokeWidth={0} />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} />
          )}
        </button>
      </div>

      {/* Who, and how many stars. */}
      <div className="flex items-center gap-3">
        <Link to={`/profile/${review.userId}`} className="shrink-0">
          {review.author?.avatarUrl ? (
            <img
              src={review.author.avatarUrl}
              alt=""
              loading="lazy"
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to={`/profile/${review.userId}`}
            dir="auto"
            className="truncate text-card-title transition-colors duration-200 ease-soft hover:text-accent"
          >
            {isOwn ? 'You' : name}
          </Link>
          <span className="truncate text-meta text-muted-foreground">
            {review.author?.username && `@${review.author.username} · `}
            {timeAgo(review.createdAt)}
            {review.edited && ' · edited'}
          </span>
        </div>
        <StarRating value={review.rating} size={14} />
        <ReviewMenu review={review} isOwn={isOwn} onDeleted={() => onDeleted(review)} />
      </div>

      <div className="flex flex-col gap-1.5">
        {review.title && (
          <p dir="auto" className="text-card-title">
            {review.title}
          </p>
        )}
        {review.body && (
          <p dir="auto" className="whitespace-pre-line text-body text-muted-foreground">
            {review.body}
          </p>
        )}
      </div>

      <ReviewActions review={review} className="-ml-2" />
    </article>
  )
}

/** "…": Delete on your own review, Report on anyone else's. */
function ReviewMenu({
  review,
  isOwn,
  onDeleted,
}: {
  review: FeedReview
  isOwn: boolean
  onDeleted: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [pending, setPending] = useState(false)

  function close() {
    setOpen(false)
    setConfirmingDelete(false)
  }

  async function remove() {
    if (!user) return navigate('/login')
    setPending(true)
    try {
      await deleteReview(review.song.id, user.id)
      close()
      onDeleted()
      toast.show({ message: 'Review deleted' })
    } catch (err) {
      console.error('[beatboxed] delete review failed:', err)
      toast.show({ message: "Couldn't delete that. Try again." })
    } finally {
      setPending(false)
    }
  }

  const item =
    'w-full rounded-button px-3 py-2.5 text-left text-body transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-60'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Review options"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground"
      >
        <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
      </button>

      <Sheet open={open} onClose={close} title="Review options" className="sm:w-56">
        {isOwn ? (
          confirmingDelete ? (
            <div className="flex flex-col gap-2 p-1">
              <p className="px-2 pt-1 text-body">Delete this review?</p>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={pending}
                className={cn(item, 'text-danger hover:bg-danger/10')}
              >
                Delete
              </button>
              <button type="button" onClick={close} className={cn(item, 'text-muted-foreground')}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={cn(item, 'text-danger hover:bg-danger/10')}
            >
              Delete
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              close()
              setReporting(true)
            }}
            className={item}
          >
            Report
          </button>
        )}
      </Sheet>

      {user && !isOwn && (
        <ReportDialog
          open={reporting}
          onClose={() => setReporting(false)}
          onReported={() => {
            setReporting(false)
            toast.show({ message: "Thanks. We'll take a look." })
          }}
          reporterId={user.id}
          reviewId={review.id}
        />
      )}
    </div>
  )
}

function ReportDialog({
  open,
  onClose,
  onReported,
  reporterId,
  reviewId,
}: {
  open: boolean
  onClose: () => void
  onReported: () => void
  reporterId: string
  reviewId: string
}) {
  const titleId = useId()
  const [reason, setReason] = useState<string>(REPORT_REASONS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function submit() {
    setPending(true)
    setError(false)
    try {
      await reportReview(reporterId, reviewId, reason)
      onReported()
    } catch (err) {
      console.error('[beatboxed] report failed:', err)
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id={titleId} className="text-section-title">
          Report this review
        </h2>
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-3 rounded-button px-2 py-2.5 hover:bg-white/5"
            >
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="size-4 accent-primary"
              />
              <span className="text-body">{r}</span>
            </label>
          ))}
        </fieldset>
        {error && <p className="text-body text-danger">That didn't send. Try again.</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="rounded-button bg-primary px-4 py-2.5 text-button text-white transition-colors duration-200 ease-soft hover:bg-accent disabled:opacity-60"
          >
            Report
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-button px-4 py-2.5 text-button text-muted-foreground hover:text-foreground sm:mr-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
