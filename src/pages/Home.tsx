import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, PenLine, Users } from 'lucide-react'
import { FeedCard } from '@/components/feed/FeedCard'
import { ReviewComposer } from '@/components/feed/ReviewComposer'
import { PersonCard } from '@/components/people/PersonCard'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/hooks/useProfile'
import { useToast } from '@/lib/toast'
import {
  getFeedPage,
  getSuggestedReviewers,
  type FeedCursor,
  type FeedReview,
  type FeedTab,
  type SuggestedReviewer,
} from '@/lib/feed'
import { cn } from '@/lib/cn'

/**
 * Home is the review feed: what people are saying about music, not a place
 * to browse it (the song rails moved to Explore).
 *
 *   For You    public reviews plus people you follow, ranked (feed_for_you)
 *   Following  people you follow, plus your own, newest first
 *
 * Both only list reviews with FEED_MIN_CHARS of written text, and both are
 * filtered for privacy in the database; nothing here decides who may see what.
 */

type TabState = {
  items: FeedReview[]
  next: FeedCursor | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadingMore: boolean
  moreError: boolean
}

const EMPTY: TabState = {
  items: [],
  next: null,
  status: 'idle',
  loadingMore: false,
  moreError: false,
}

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
]

export default function Home() {
  const { user } = useAuth()
  const { profile, displayName } = useProfile()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: FeedTab = params.get('tab') === 'following' ? 'following' : 'for-you'

  const [tabs, setTabs] = useState<Record<FeedTab, TabState>>({
    'for-you': EMPTY,
    following: EMPTY,
  })
  /**
   * Reviews posted from here this visit, shown at the top of both tabs right
   * away rather than waiting for a refetch to place them. For You never lists
   * your own reviews, so after a reload yours stays on Following only.
   */
  const [pinned, setPinned] = useState<FeedReview[]>([])
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const patch = useCallback((t: FeedTab, p: Partial<TabState>) => {
    setTabs((prev) => ({ ...prev, [t]: { ...prev[t], ...p } }))
  }, [])

  const loadFirst = useCallback(
    async (t: FeedTab) => {
      if (!user) return
      patch(t, { ...EMPTY, status: 'loading' })
      try {
        const page = await getFeedPage(t, user.id, null)
        patch(t, { items: page.items, next: page.next, status: 'ready' })
      } catch (err) {
        console.error(`[beatboxed] ${t} feed failed:`, err)
        patch(t, { status: 'error' })
      }
    },
    [user, patch]
  )

  // Each tab loads the first time it's shown, then keeps its place.
  useEffect(() => {
    if (tabs[tab].status === 'idle') void loadFirst(tab)
  }, [tab, tabs, loadFirst])

  const loadMore = useCallback(async () => {
    const state = tabs[tab]
    if (!user || !state.next || state.loadingMore) return
    patch(tab, { loadingMore: true, moreError: false })
    try {
      const page = await getFeedPage(tab, user.id, state.next)
      setTabs((prev) => {
        const cur = prev[tab]
        // A like landing mid-scroll can move a For You score across a page
        // boundary; never show the same review twice.
        const seen = new Set(cur.items.map((r) => r.id))
        return {
          ...prev,
          [tab]: {
            ...cur,
            items: [...cur.items, ...page.items.filter((r) => !seen.has(r.id))],
            next: page.next,
            loadingMore: false,
          },
        }
      })
    } catch (err) {
      console.error(`[beatboxed] ${tab} feed page failed:`, err)
      patch(tab, { loadingMore: false, moreError: true })
    }
  }, [tabs, tab, user, patch])

  // More loads as the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null)
  const current = tabs[tab]
  useEffect(() => {
    const el = sentinel.current
    if (!el || !current.next || current.moreError) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [current.next, current.moreError, loadMore])

  function setTab(next: FeedTab) {
    setParams(next === 'for-you' ? {} : { tab: next }, { replace: true })
  }

  function handlePosted(review: FeedReview) {
    setComposing(false)
    // Replace any earlier copy (an edit, or a re-post of the same song).
    const without = (list: FeedReview[]) =>
      list.filter((r) => r.id !== review.id && !(r.userId === review.userId && r.song.id === review.song.id))
    setPinned((prev) => [review, ...without(prev)])
    setTabs((prev) => ({
      'for-you': { ...prev['for-you'], items: without(prev['for-you'].items) },
      following: { ...prev.following, items: without(prev.following.items) },
    }))
    setHighlightId(review.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    toast.show({
      message: 'Review posted',
      actionLabel: 'View song',
      onAction: () => navigate(`/song/${review.song.id}`),
    })
  }

  function handleDeleted(review: FeedReview) {
    const drop = (list: FeedReview[]) => list.filter((r) => r.id !== review.id)
    setPinned(drop)
    setTabs((prev) => ({
      'for-you': { ...prev['for-you'], items: drop(prev['for-you'].items) },
      following: { ...prev.following, items: drop(prev.following.items) },
    }))
  }

  const pinnedIds = new Set(pinned.map((r) => r.id))
  const visible = [...pinned, ...current.items.filter((r) => !pinnedIds.has(r.id))]
  const avatarUrl = profile?.avatar_url ?? null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-4">
      <h1 className="sr-only">Home</h1>

      <div role="tablist" aria-label="Feed" className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`feed-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`feed-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-full border px-4 py-2 text-button transition-colors duration-200 ease-soft',
              tab === t.id
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-transparent bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The way in to writing: looks like a field, opens the composer. */}
      <button
        type="button"
        onClick={() => setComposing(true)}
        aria-label="Write a review: what song is on your mind?"
        className="flex items-center gap-3 rounded-card border border-white/5 bg-surface p-4 text-left shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="flex-1 text-body text-muted-foreground">What song is on your mind?</span>
        <PenLine className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
      </button>

      <section
        role="tabpanel"
        id={`feed-panel-${tab}`}
        aria-labelledby={`feed-tab-${tab}`}
        // Busy until the first load has answered, including the render
        // before it starts, so nothing reads an empty tab as "no reviews".
        aria-busy={current.status === 'idle' || current.status === 'loading'}
        className="flex flex-col gap-4"
      >
        {current.status === 'error' ? (
          <ErrorPanel
            message="Couldn't load the feed. Check your connection."
            onRetry={() => void loadFirst(tab)}
          />
        ) : current.status !== 'ready' && visible.length === 0 ? (
          <FeedSkeleton />
        ) : visible.length === 0 ? (
          tab === 'following' ? (
            <FollowingEmpty onFollowed={() => void loadFirst('following')} />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-12 text-center">
              <p className="text-card-title">No takes yet</p>
              <p className="max-w-sm text-body text-muted-foreground">
                Be the first: pick a song and say what you hear in it.
              </p>
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="rounded-button bg-primary px-4 py-2.5 text-button text-white hover:bg-accent"
              >
                Write a review
              </button>
            </div>
          )
        ) : (
          <>
            {visible.map((r) => (
              <FeedCard
                key={r.id}
                review={r}
                highlight={r.id === highlightId}
                onDeleted={handleDeleted}
              />
            ))}

            <div ref={sentinel} aria-hidden className="h-px" />
            {current.loadingMore && (
              <div role="status" className="flex items-center justify-center gap-2 py-4 text-secondary text-muted-foreground">
                <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                Loading more…
              </div>
            )}
            {current.moreError && (
              <ErrorPanel message="Couldn't load more." onRetry={() => void loadMore()} />
            )}
          </>
        )}
      </section>

      <ReviewComposer
        open={composing}
        onClose={() => setComposing(false)}
        onPosted={handlePosted}
      />
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-card bg-surface p-4">
          <div className="flex items-center gap-3 rounded-[12px] bg-surface-2 p-2.5">
            <div className="size-14 animate-pulse rounded-[10px] bg-white/5" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/5" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-surface-2" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center">
      <p className="text-body text-danger">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-button bg-surface-2 px-4 py-2 text-button text-foreground hover:bg-white/10"
      >
        Retry
      </button>
    </div>
  )
}

/**
 * An empty Following tab is a starting point, not a dead end: a few public
 * accounts that review often, each a tap from being followed.
 */
function FollowingEmpty({ onFollowed }: { onFollowed: () => void }) {
  const [people, setPeople] = useState<SuggestedReviewer[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(false)
    getSuggestedReviewers(5)
      .then((p) => {
        if (!cancelled) setPeople(p)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] suggestions failed:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div className="flex flex-col gap-4 rounded-card bg-surface p-5">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <Users className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="text-card-title">Follow people to see their takes here</p>
      </div>

      {error ? (
        <ErrorPanel message="Couldn't load suggestions." onRetry={() => setAttempt((n) => n + 1)} />
      ) : people === null ? (
        <div className="h-16 animate-pulse rounded-card bg-surface-2" />
      ) : (
        people.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-meta uppercase tracking-wide text-muted-foreground">
              People who review often
            </p>
            {people.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                state="none"
                onStateChange={(next) => {
                  // Following a public account is instant, so their reviews
                  // can show straight away.
                  if (next === 'following') onFollowed()
                }}
              />
            ))}
          </div>
        )
      )}

      <Link
        to="/explore?filter=people"
        className="self-center rounded-button px-3 py-2 text-button text-accent hover:text-foreground"
      >
        Find people
      </Link>
    </div>
  )
}
