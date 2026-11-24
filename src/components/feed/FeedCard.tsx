import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MoreHorizontal, Pause, Play } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Sheet } from '@/components/ui/Sheet'
import { Modal } from '@/components/ui/Modal'
import { ReviewConversation } from '@/components/conversations/ReviewConversation'
import { MuteConfirm, type MuteTarget } from '@/components/mutes/MuteConfirm'
import { Artwork } from './Artwork'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { deleteReview } from '@/lib/catalog'
import { REPORT_REASONS, reportReview, type FeedReview } from '@/lib/feed'
import { cardGlowStyle, useCoverColors } from '@/lib/coverColors'
import { useMutedIds } from '@/lib/mutes'
import { cn } from '@/lib/cn'
import { logError } from '@/lib/log'

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
 * what they said. Likes and the conversation are ReviewConversation, shared
 * with the song page, so they behave the same everywhere.
 */
export function FeedCard({
  review,
  highlight = false,
  onDeleted,
  variant = 'feed',
  hideIfMuted = true,
}: {
  review: FeedReview
  /** Just posted: outline it briefly so the eye finds it. */
  highlight?: boolean
  onDeleted: (review: FeedReview) => void
  /**
   * profile: on someone's own profile the author row would only repeat
   * whose page it is, so it becomes stars and date; the body is clamped to
   * four lines with "Read more", and the text opens the review.
   */
  variant?: 'feed' | 'profile'
  /**
   * Reviews by someone you muted disappear everywhere except their own
   * profile, which passes false. The database already leaves them out of
   * the feeds; this also covers the moment you mute.
   */
  hideIfMuted?: boolean
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
  const colors = useCoverColors(song.coverUrl)
  const muted = useMutedIds(user?.id).has(review.userId)

  if (muted && hideIfMuted && !isOwn) return null

  const profile = variant === 'profile'
  const menu = <ReviewMenu review={review} isOwn={isOwn} onDeleted={() => onDeleted(review)} />

  return (
    <article
      ref={ref}
      data-review-id={review.id}
      data-highlighted={flash || undefined}
      className={cn(reviewRowClass, flash && 'bg-primary/[0.09]')}
    >
      {!profile && (
        <Link to={`/profile/${review.userId}`} className="shrink-0" aria-hidden tabIndex={-1}>
          <ReviewAvatar name={name} url={review.author?.avatarUrl} />
        </Link>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Who and when, on one line. On their own profile: stars and when. */}
        {profile ? (
          <div className="-my-1.5 flex min-h-8 items-center gap-2">
            <StarRating value={review.rating} size={14} />
            <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
              {timeAgo(review.createdAt)}
              {review.edited && ' · edited'}
            </span>
            {menu}
          </div>
        ) : (
          <div className="-my-1.5 flex min-h-8 items-center gap-1.5">
            <ReviewByline
              href={`/profile/${review.userId}`}
              name={isOwn ? 'You' : name}
              meta={
                <>
                  {review.author?.username && `@${review.author.username} · `}
                  {timeAgo(review.createdAt)}
                  {review.edited && ' · edited'}
                </>
              }
            />
            {menu}
          </div>
        )}

        {review.title &&
          (profile ? (
            <Link
              to={`/song/${song.id}?review=${review.id}`}
              dir="auto"
              className="block w-full text-[15px] font-semibold leading-snug transition-colors duration-200 ease-soft hover:text-accent"
            >
              {review.title}
            </Link>
          ) : (
            <p dir="auto" className="w-full text-[15px] font-semibold leading-snug">
              {review.title}
            </p>
          ))}
        {review.body &&
          (profile ? (
            <ClampedBody text={review.body} href={`/song/${song.id}?review=${review.id}`} />
          ) : (
            <p dir="auto" className={reviewBodyClass}>
              {review.body}
            </p>
          ))}

        {/* The song: a small chip. Artwork and title open its page; the artist opens theirs. */}
        <div
          style={cardGlowStyle(colors)}
          className="mt-1.5 flex items-center gap-2.5 rounded-inset border border-line bg-white/[0.025] py-1 pl-1 pr-2"
        >
          <Link to={`/song/${song.id}`} aria-hidden tabIndex={-1} className="shrink-0">
            <Artwork src={song.coverUrl} seed={song.id} className="size-9 rounded-thumb" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <Link
              to={`/song/${song.id}`}
              dir="auto"
              className="truncate text-[13.5px] font-semibold leading-tight transition-colors duration-200 ease-soft hover:text-accent"
            >
              {song.title}
            </Link>
            {song.artistId ? (
              <Link
                to={`/artist/${song.artistId}`}
                className="w-fit max-w-full truncate text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                {song.artistName}
              </Link>
            ) : (
              <span className="truncate text-meta text-muted-foreground">{song.artistName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => (isCurrent ? player.toggle() : player.playQueue([song], 0))}
            aria-label={isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
            className="group/play tap-44 grid size-8 shrink-0 place-items-center rounded-full"
          >
            <span className="grid size-8 place-items-center rounded-full bg-primary text-white shadow-glow-sm transition-all duration-200 ease-soft group-hover/play:bg-accent group-active/play:scale-95">
              {isCurrent && player.loading ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
              ) : isPlaying ? (
                <Pause className="size-3.5 fill-current" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 size-3.5 fill-current" strokeWidth={0} />
              )}
            </span>
          </button>
        </div>

        <ReviewConversation
          review={review}
          song={{ id: song.id, title: song.title, artistName: song.artistName, coverUrl: song.coverUrl }}
          leading={profile ? undefined : <StarRating value={review.rating} size={13} glow />}
        />
      </div>
    </article>
  )
}

/**
 * A list of review rows: edge to edge with hairline dividers on a phone,
 * one quiet panel with the same dividers from `sm` up.
 */
export const reviewListClass =
  '-mx-4 flex flex-col divide-y divide-line border-y border-line sm:mx-0 sm:overflow-hidden sm:rounded-card sm:border sm:bg-surface/60 sm:shadow-card'

/** One review row: avatar column, then the content. No box of its own. */
export const reviewRowClass =
  'flex scroll-mt-36 gap-3 px-4 pb-1 pt-3 transition-colors duration-500 ease-soft sm:px-5'

/** Review text: 15px, readable, wraps (Arabic lines up on the right). */
export const reviewBodyClass =
  'block w-full whitespace-pre-line text-[15px] leading-[1.45] text-foreground/[0.88]'

/** The 40px round avatar, or the first letter on a plain disc. */
export function ReviewAvatar({ name, url }: { name: string; url?: string | null }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className="size-10 rounded-full object-cover ring-1 ring-white/10" />
  ) : (
    <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground ring-1 ring-white/10">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Name, then handle and time in grey, on one line that truncates. */
export function ReviewByline({ href, name, meta }: { href: string; name: string; meta: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <Link
        to={href}
        dir="auto"
        className="min-w-0 max-w-[65%] shrink-0 truncate text-[15px] font-semibold leading-snug transition-colors duration-200 ease-soft hover:text-accent"
      >
        {name}
      </Link>
      <span className="min-w-0 truncate text-[13.5px] text-muted-foreground">{meta}</span>
    </span>
  )
}

/**
 * A review body clamped to four lines, opening the review when tapped. "Read
 * more" appears only when the text is actually cut, and expands it in place.
 */
function ClampedBody({ text, href }: { text: string; href: string }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])

  return (
    <div className="flex flex-col items-stretch">
      <Link
        ref={ref}
        to={href}
        dir="auto"
        className={cn(
          // A full-width block, so Arabic lines up on the right like any
          // right-to-left paragraph.
          reviewBodyClass,
          'transition-colors duration-200 ease-soft hover:text-foreground',
          // line-clamp needs its own display, so it replaces the block.
          !open && 'line-clamp-4!'
        )}
      >
        {text}
      </Link>
      {cut && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-mx-2 -my-1.5 min-h-11 self-start rounded-button px-2 text-[13.5px] font-semibold text-accent hover:text-foreground"
        >
          Read more
        </button>
      )}
    </div>
  )
}

/** "…": Delete on your own review, Report on anyone else's. */
function ReviewMenu({
  review,
  isOwn,
  onDeleted,
  onMuted,
}: {
  review: FeedReview
  isOwn: boolean
  onDeleted: () => void
  /** Muting the author: the feed drops their reviews straight away. */
  onMuted?: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [muting, setMuting] = useState<MuteTarget | null>(null)
  const [pending, setPending] = useState(false)
  const authorName = review.author?.displayName || review.author?.username || 'Someone'
  const authorHandle = review.author?.username ? `@${review.author.username}` : authorName

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
      logError('feed', 'delete review failed', { error: err })
      toast.show({ message: "Couldn't delete that. Try again." })
    } finally {
      setPending(false)
    }
  }

  const item =
    'w-full rounded-button px-3 py-2.5 text-left text-body transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-60'

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
          <>
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
            <button
              type="button"
              onClick={() => {
                close()
                setMuting({
                  id: review.userId,
                  username: review.author?.username ?? null,
                  name: authorName,
                  avatarUrl: review.author?.avatarUrl ?? null,
                })
              }}
              className={item}
            >
              Mute {authorHandle}
            </button>
          </>
        )}
      </Sheet>
      <MuteConfirm target={muting} onClose={() => setMuting(null)} onMuted={onMuted} />

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
      logError('feed', 'report failed', { error: err })
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
