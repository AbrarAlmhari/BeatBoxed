import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Disc3, Loader2, Pause, Play } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useLoadMore } from '@/components/profile/useLoadMore'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/cn'
import { getRailPage, trackKey, type RailId } from '@/lib/catalog'
import type { SongCardModel } from '@/lib/types'

const RAILS: Record<RailId, { title: string; subtitle: string; empty: string }> = {
  trending: {
    title: 'Trending',
    subtitle: 'The most popular songs on Beatboxed right now.',
    empty: 'Nothing trending yet.',
  },
  'for-you': {
    title: 'For You',
    subtitle: 'Picked from the songs and artists you listen to and review.',
    empty: "Follow a few artists and we'll pick songs for you.",
  },
  recent: {
    title: 'Recently viewed',
    subtitle: 'Songs you opened or played, newest first.',
    empty: "Songs you open or play will show up here.",
  },
}

/**
 * An Explore rail's full list ("See all"): the same songs as the rail, in
 * the same order, 20 at a time as you scroll. Each row opens its song page;
 * the play button plays the list from that song.
 */
export default function RailList() {
  const { rail = '' } = useParams()
  const known = rail in RAILS ? (rail as RailId) : null
  const { user } = useAuth()
  const player = usePlayer()

  const [items, setItems] = useState<SongCardModel[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  const loadFirst = useCallback(async () => {
    if (!known) return
    const request = ++latest.current
    setItems(null)
    setFailed(false)
    try {
      // Fresh each visit, so the list matches the rail just seen.
      const page = await getRailPage(known, user?.id, 0, true)
      if (request !== latest.current) return
      setItems(page.items)
      setHasMore(page.hasMore)
    } catch (err) {
      console.error('[beatboxed] rail list failed:', err)
      if (request === latest.current) setFailed(true)
    }
  }, [known, user?.id])

  useEffect(() => {
    void loadFirst()
  }, [loadFirst])

  const more = useCallback(async () => {
    if (!known || !items || loadingMore || !hasMore) return
    const request = latest.current
    setLoadingMore(true)
    try {
      const page = await getRailPage(known, user?.id, items.length)
      if (request !== latest.current) return
      // A track already listed (the same song, or another copy of it from
      // a different release) isn't listed again.
      const seen = new Set(items.map(trackKey))
      setItems([...items, ...page.items.filter((s) => !seen.has(trackKey(s)))])
      setHasMore(page.hasMore)
    } catch (err) {
      console.error('[beatboxed] more rail songs failed:', err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [known, items, loadingMore, hasMore, user?.id])

  const sentinel = useLoadMore(() => void more(), hasMore && !loadingMore)

  if (!known) return <Navigate to="/explore" replace />
  const meta = RAILS[known]

  return (
    <div className="relative isolate flex flex-col gap-6 pt-2">
      <PageGlow strength="soft" />
      <header className="flex flex-col gap-1">
        <h1 className="text-page-title">{meta.title}</h1>
        <p className="text-secondary text-muted-foreground">{meta.subtitle}</p>
      </header>

      {failed ? (
        <EmptyState
          face="sad"
          tone="error"
          title="Couldn't load these songs."
          action={
            <button type="button" onClick={() => void loadFirst()} className={emptySecondaryActionClass}>
              Retry
            </button>
          }
        />
      ) : items === null ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <SkeletonList rows={8} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          face="sleepy-sticker"
          title={meta.empty}
          action={
            <Link to="/explore" className={emptyActionClass}>
              Back to Explore
            </Link>
          }
        />
      ) : (
        <>
          <Card as="ol" padding="sm" className="flex flex-col gap-0.5" aria-label={meta.title}>
            {items.map((song, i) => {
              const isCurrent = player.current?.id === song.id
              return (
                <li
                  key={song.id}
                  className={cn(
                    'flex items-center gap-3 rounded-inset px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface-2',
                    isCurrent && 'bg-surface-2'
                  )}
                >
                  <span className="w-6 shrink-0 text-end text-meta text-muted-foreground tabular-nums">{i + 1}</span>
                  <Link
                    to={`/song/${song.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 transition-colors duration-200 ease-soft hover:text-accent"
                  >
                    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-thumb bg-surface-2">
                      {song.coverUrl ? (
                        <img src={song.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <Disc3 className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span dir="auto" className={cn('block truncate text-card-title', isCurrent && 'text-primary')}>
                        {song.title}
                      </span>
                      <span dir="auto" className="block truncate text-secondary text-muted-foreground">
                        {song.artistName}
                      </span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => (isCurrent ? player.toggle() : player.playQueue(items, i))}
                    aria-label={isCurrent && player.isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95"
                  >
                    {isCurrent && player.loading ? (
                      <Loader2 className="size-[18px] animate-spin" strokeWidth={2.5} aria-hidden />
                    ) : isCurrent && player.isPlaying ? (
                      <Pause className="size-[18px] fill-current" strokeWidth={2} />
                    ) : (
                      <Play className="size-[18px] translate-x-px fill-current" strokeWidth={2} />
                    )}
                  </button>
                </li>
              )
            })}
          </Card>
          <div ref={sentinel} aria-hidden className="h-px" />
          {loadingMore && (
            <div role="status">
              <span className="sr-only">Loading more…</span>
              <SkeletonList rows={2} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
