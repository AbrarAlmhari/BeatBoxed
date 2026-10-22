import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Loader2, PenLine } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { Sheet } from '@/components/ui/Sheet'
import { StarRating } from '@/components/ui/StarRating'
import { FeedCard, timeAgo } from '@/components/feed/FeedCard'
import { Artwork } from '@/components/feed/Artwork'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { useLoadMore } from './useLoadMore'
import { useAuth } from '@/lib/auth'
import {
  getProfileReviews,
  isWritten,
  type ReviewFilter,
  type ReviewSortKey,
} from '@/lib/profile'
import type { FeedReview } from '@/lib/feed'
import { cn } from '@/lib/cn'

const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'written', label: 'Written' },
  { id: 'ratings', label: 'Ratings only' },
]

const SORTS: { id: ReviewSortKey; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'highest', label: 'Highest rated' },
  { id: 'liked', label: 'Most liked' },
]

/**
 * Everything someone has rated. Written reviews are full cards, like the
 * Home feed's; ratings with no text are compact rows. 20 at a time.
 */
export function ProfileReviewsTab({
  userId,
  isOwn,
  handle,
  filter,
  onFilterChange,
  onWrite,
  reloadKey,
  counts,
}: {
  userId: string
  isOwn: boolean
  /** "@name" for someone else's empty state. */
  handle: string
  filter: ReviewFilter
  onFilterChange: (next: ReviewFilter) => void
  /** Opens the review composer (own profile, empty state). */
  onWrite: () => void
  /** Bumped by the page after a new review is posted, to reload. */
  reloadKey: number
  /** For the chips: all ratings, and written (null until counted). */
  counts?: { all: number; written: number | null }
}) {
  const { user } = useAuth()
  const [sort, setSort] = useState<ReviewSortKey>('recent')
  const [items, setItems] = useState<FeedReview[]>([])
  const [all, setAll] = useState<FeedReview[] | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  // Each load gets a number; only the newest one may update the list.
  // Switching filters quickly used to let a slower, older answer land last
  // and show the wrong filter's reviews.
  const latest = useRef(0)

  const load = useCallback(async () => {
    if (!user) return
    const request = ++latest.current
    setStatus('loading')
    setItems([])
    setAll(undefined)
    try {
      const page = await getProfileReviews(userId, user.id, { filter, sort, offset: 0 })
      if (request !== latest.current) return
      setItems(page.items)
      setAll(page.all)
      setHasMore(page.hasMore)
      setStatus('ready')
    } catch (err) {
      if (request !== latest.current) return
      console.error('[beatboxed] profile reviews failed:', err)
      setStatus('error')
    }
  }, [user, userId, filter, sort])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  async function more() {
    if (!user || loadingMore || !hasMore) return
    const request = latest.current
    setLoadingMore(true)
    try {
      const page = await getProfileReviews(userId, user.id, {
        filter,
        sort,
        offset: items.length,
        cachedAll: all,
      })
      // A filter or sort change since this started: its page is stale.
      if (request !== latest.current) return
      const seen = new Set(items.map((r) => r.id))
      setItems((prev) => [...prev, ...page.items.filter((r) => !seen.has(r.id))])
      setHasMore(page.hasMore)
    } catch (err) {
      console.error('[beatboxed] more profile reviews failed:', err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }
  const sentinel = useLoadMore(() => void more(), status === 'ready' && hasMore)

  /** "All 19", "Written 12", "Ratings only 7"; nothing while uncounted. */
  function chipCount(id: ReviewFilter): number | null {
    if (!counts) return null
    if (id === 'all') return counts.all
    if (counts.written === null) return null
    return id === 'written' ? counts.written : Math.max(0, counts.all - counts.written)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip key={f.id} active={filter === f.id} onClick={() => onFilterChange(f.id)} touchTarget>
              {f.label}
              {chipCount(f.id) !== null && (
                <span className="ml-1.5 tabular-nums opacity-75">{chipCount(f.id)!.toLocaleString()}</span>
              )}
            </Chip>
          ))}
        </div>
        <SortMenu sort={sort} onChange={setSort} />
      </div>

      {status === 'error' ? (
        <EmptyState
          face="sad"
          tone="error"
          title="Couldn't load reviews."
          action={
            <button type="button" onClick={() => void load()} className={emptySecondaryActionClass}>
              Retry
            </button>
          }
        />
      ) : status === 'loading' ? (
        <ReviewsSkeleton />
      ) : items.length === 0 ? (
        filter === 'all' ? (
          isOwn ? (
            <EmptyState
              face="thinking-sticker"
              title="No reviews yet"
              detail="Rate a song or tell people what you hear in it."
              action={
                <button type="button" onClick={onWrite} className={emptyActionClass}>
                  <PenLine className="size-4" strokeWidth={2} aria-hidden />
                  Write your first review
                </button>
              }
            />
          ) : (
            <EmptyState face="sleepy-sticker" title={`${handle} hasn't reviewed anything yet.`} />
          )
        ) : (
          <EmptyState
            face="thinking-sticker"
            title={filter === 'written' ? 'No written reviews' : 'No ratings without a review'}
            action={
              <button type="button" onClick={() => onFilterChange('all')} className={emptyActionClass}>
                Show all
              </button>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              {isWritten(r) ? (
                <FeedCard
                  review={r}
                  variant="profile"
                  // Their own profile is where a muted person's reviews still show.
                  hideIfMuted={false}
                  onDeleted={(gone) => setItems((prev) => prev.filter((x) => x.id !== gone.id))}
                />
              ) : (
                <RatingRow review={r} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />
      {loadingMore && (
        <div role="status" className="flex items-center justify-center gap-2 py-3 text-secondary text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading more…
        </div>
      )}
    </div>
  )
}

/** A rating with no text: cover, title, artist, stars, date. One line. */
function RatingRow({ review }: { review: FeedReview }) {
  const { song } = review
  return (
    <Link
      to={`/song/${song.id}?review=${review.id}`}
      className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-2.5 pr-4 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
    >
      <Artwork src={song.coverUrl} seed={song.id} alt={`Cover of ${song.title}`} className="size-12" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-card-title">
          {song.title}
        </span>
        <span dir="auto" className="truncate text-secondary text-muted-foreground">
          {song.artistName}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StarRating value={review.rating} size={13} />
        <span className="text-meta text-muted-foreground">{timeAgo(review.createdAt)}</span>
      </span>
    </Link>
  )
}

function SortMenu({ sort, onChange }: { sort: ReviewSortKey; onChange: (s: ReviewSortKey) => void }) {
  const [open, setOpen] = useState(false)
  const label = SORTS.find((s) => s.id === sort)?.label ?? 'Recent'
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Sort: ${label}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-button px-3 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
      >
        {label}
        <ChevronDown className="size-4" strokeWidth={2} aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sort reviews" className="sm:w-52">
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === sort}
            onClick={() => {
              onChange(s.id)
              setOpen(false)
            }}
            className={cn(
              'flex min-h-11 w-full items-center justify-between gap-3 rounded-button px-3 text-left text-body hover:bg-white/5',
              s.id === sort ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {s.label}
            {s.id === sort && <Check className="size-4 text-primary" strokeWidth={2.25} aria-hidden />}
          </button>
        ))}
      </Sheet>
    </div>
  )
}

function ReviewsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-card bg-surface p-4">
          <div className="flex items-center gap-3 rounded-inset bg-surface-2 p-2.5">
            <div className="size-14 animate-pulse rounded-cover bg-white/5" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/5" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
            </div>
          </div>
          <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
      {[0, 1].map((i) => (
        <div key={`r${i}`} className="flex items-center gap-3 rounded-card bg-surface p-2.5">
          <div className="size-12 animate-pulse rounded-cover bg-surface-2" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  )
}
