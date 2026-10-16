import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Share2, Star, X } from 'lucide-react'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { Card } from '@/components/ui/Card'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton'
import { StatsBarChart } from './StatsBarChart'
import { TopGenresCard } from './TopGenresCard'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  STATS_MIN_RATINGS,
  STATS_RANGES,
  beatieTake,
  getAllRatedArtists,
  getUserStats,
  type StatsArtist,
  type StatsRange,
  type UserStats,
} from '@/lib/stats'

type Loaded = { status: 'ready'; stats: UserStats } | { status: 'hidden' } | { status: 'error' }

/**
 * The profile's Stats tab, after docs/mockups/beatboxed-stats-mockup.html:
 * the time range, Beatie's take, headline tiles, the ratings spread, ratings
 * by decade, top genres, most rated artists, and Share.
 *
 * Each range is fetched once and kept, so switching back is instant; a range
 * not seen yet shows the layout as a skeleton while it loads.
 */
export function ProfileStatsTab({
  userId,
  isOwn,
  handle,
}: {
  userId: string
  isOwn: boolean
  handle: string
}) {
  const [range, setRange] = useState<StatsRange>('all')
  const [byRange, setByRange] = useState<Partial<Record<StatsRange, Loaded>>>({})
  const [seeAll, setSeeAll] = useState(false)

  const load = useCallback(
    async (r: StatsRange) => {
      try {
        const stats = await getUserStats(userId, r)
        setByRange((prev) => ({ ...prev, [r]: stats ? { status: 'ready', stats } : { status: 'hidden' } }))
      } catch (err) {
        console.error('[beatboxed] stats failed:', err)
        setByRange((prev) => ({ ...prev, [r]: { status: 'error' } }))
      }
    },
    [userId]
  )

  useEffect(() => {
    setByRange({})
  }, [userId])

  useEffect(() => {
    if (!byRange[range]) void load(range)
  }, [range, byRange, load])

  const current = byRange[range]

  if (current?.status === 'hidden') {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary/15">
          <Lock className="size-5 text-accent" strokeWidth={2} aria-hidden />
        </span>
        <p className="text-card-title">These stats are private.</p>
      </Card>
    )
  }

  return (
    <section aria-label="Music stats" className="grid grid-cols-1 gap-3.5 md:grid-cols-12 md:gap-4">
      <RangeControl value={range} onChange={setRange} />

      {current?.status === 'error' ? (
        <EmptyState
          face="sad"
          tone="error"
          title="Couldn't load these stats."
          className="md:col-span-12"
          action={
            <button
              type="button"
              onClick={() => {
                setByRange((prev) => ({ ...prev, [range]: undefined }))
              }}
              className={emptySecondaryActionClass}
            >
              Retry
            </button>
          }
        />
      ) : !current ? (
        <StatsSkeleton />
      ) : current.stats.total < STATS_MIN_RATINGS ? (
        <WarmingUp total={current.stats.total} isOwn={isOwn} handle={handle} />
      ) : (
        <StatsBody stats={current.stats} range={range} userId={userId} onSeeAll={() => setSeeAll(true)} />
      )}

      <AllArtistsSheet open={seeAll} onClose={() => setSeeAll(false)} userId={userId} range={range} />
    </section>
  )
}

/** All time · This year · 30 days. Pinned under the tab bar on phones. */
function RangeControl({ value, onChange }: { value: StatsRange; onChange: (r: StatsRange) => void }) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="sticky top-14 z-[5] flex gap-1.5 rounded-card border border-line bg-surface p-1 shadow-card md:static md:col-span-5 md:self-center"
    >
      {STATS_RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={value === r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            'min-h-11 flex-1 rounded-button text-button transition-colors duration-200 ease-soft',
            value === r.id
              ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/55'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function StatsBody({
  stats,
  range,
  userId,
  onSeeAll,
}: {
  stats: UserStats
  range: StatsRange
  userId: string
  onSeeAll: () => void
}) {
  const toast = useToast()
  const take = beatieTake(stats, range)
  const avg = stats.average ?? 0
  const total = stats.total

  async function share() {
    const url = `${window.location.origin}/profile/${userId}?tab=stats`
    try {
      await navigator.clipboard.writeText(url)
      toast.show({ message: 'Link copied' })
    } catch {
      toast.show({ message: "Couldn't copy the link" })
    }
  }

  return (
    <>
      {/* Beatie's take */}
      <div className="flex items-center gap-3 rounded-card border border-primary/55 bg-gradient-to-r from-primary/20 to-primary/5 px-4 py-3.5 md:col-span-7">
        <BeatieImage mood="mark" size={40} className="shrink-0" />
        <p className="text-secondary text-foreground">
          <span className="mb-0.5 block text-meta font-semibold uppercase tracking-wide text-accent">
            Beatie's take
          </span>
          {take.map((p, i) => (p.strong ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
        </p>
      </div>

      {/* Headline tiles */}
      <dl className="grid grid-cols-2 gap-2.5 md:col-span-12 md:grid-cols-4 md:gap-4">
        <Tile label="Songs rated" value={String(total)} />
        <Tile
          label="Average rating"
          value={
            <>
              {avg.toFixed(1)}
              <Star className="ms-0.5 inline size-4 -translate-y-0.5 fill-star text-star" aria-label="stars" />
            </>
          }
        />
        <Tile label="Artists" value={String(stats.artists)} />
        <Tile label="Genres" value={String(stats.genreCount)} />
      </dl>

      {/* Desktop: genres on the left over two rows, the two charts stacked right. */}
      <TopGenresCard genres={stats.genres} className="md:col-span-7 md:row-span-2 md:self-start" />

      {/* Ratings spread */}
      <Card className="md:col-span-5 md:self-start">
        <SectionHeader
          level={3}
          title="Ratings spread"
          subtitle={`${total} ${total === 1 ? 'rating' : 'ratings'} · average ${avg.toFixed(1)}★`}
          className="mb-3"
        />
        <StatsBarChart
          caption="Ratings per star"
          bars={stats.spread.map((v, i) => ({
            key: String(i + 1),
            label: <span className="tracking-tighter text-star">{'★'.repeat(i + 1)}</span>,
            name: `${i + 1} ${i === 0 ? 'star' : 'stars'}`,
            value: v,
            tip: [`${i + 1}★ · ${v} ${v === 1 ? 'song' : 'songs'}`, `${Math.round((v / total) * 100)}% of the ratings`],
          }))}
        />
      </Card>

      {/* By decade */}
      <Card className="md:col-span-5 md:self-start">
        <SectionHeader level={3} title="By decade" subtitle="When the rated songs came out" className="mb-3" />
        {stats.decades.length === 0 ? (
          <p className="py-6 text-center text-secondary text-muted-foreground">No release dates for these songs yet.</p>
        ) : (
          <StatsBarChart
            caption="Ratings per release decade"
            bars={stats.decades.map((d) => ({
              key: String(d.decade),
              label: d.label,
              name: `${d.decade}s`,
              value: d.count,
              tip: [`${d.label} · ${d.count} ${d.count === 1 ? 'song' : 'songs'}`, `Released in the ${d.decade}s`],
            }))}
          />
        )}
      </Card>

      {/* Most rated artists */}
      <Card className="md:col-span-12">
        <SectionHeader
          level={3}
          title="Most rated artists"
          subtitle="Tap to open the artist page"
          seeAll={{ onClick: onSeeAll }}
          className="mb-3"
        />
        <ol className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
          {stats.topArtists.map((a, i) => (
            <li key={a.id} className="w-[126px] shrink-0 snap-start md:w-auto">
              <ArtistTile artist={a} rank={i + 1} />
            </li>
          ))}
        </ol>
      </Card>

      <button
        type="button"
        onClick={() => void share()}
        className="flex min-h-13 items-center justify-center gap-2 rounded-card bg-primary px-5 text-button text-white shadow-card transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.99] md:col-span-4 md:col-start-9"
      >
        <Share2 className="size-[18px]" strokeWidth={2} aria-hidden />
        Share my stats
      </button>
    </>
  )
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card padding="none" className="flex flex-col-reverse px-3.5 py-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="text-[26px] font-extrabold leading-tight tracking-tight tabular-nums">{value}</dd>
    </Card>
  )
}

function ArtistTile({ artist, rank }: { artist: StatsArtist; rank: number }) {
  return (
    <Link
      to={`/artist/${artist.id}`}
      aria-label={`${artist.name}, ${artist.count} ${artist.count === 1 ? 'song' : 'songs'} rated, average ${artist.average.toFixed(1)} stars`}
      className="flex h-full flex-col items-center gap-1.5 rounded-card border border-line bg-surface-2 p-3 text-center transition-colors duration-200 ease-soft hover:bg-white/10"
    >
      <span className="relative">
        {artist.photo ? (
          <img src={artist.photo} alt="" loading="lazy" className="size-[72px] rounded-full object-cover" />
        ) : (
          <span className="grid size-[72px] place-items-center rounded-full bg-primary/25 text-card-title">
            {artist.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="absolute -left-1 -top-1 grid size-6 place-items-center rounded-full border-2 border-primary bg-background text-[11px] font-bold">
          {rank}
        </span>
      </span>
      <b dir="auto" className="w-full truncate text-secondary font-semibold">
        {artist.name}
      </b>
      <small className="whitespace-nowrap text-meta text-muted-foreground">
        {artist.count} {artist.count === 1 ? 'song' : 'songs'} · <span className="text-star">{artist.average.toFixed(1)}★</span>
      </small>
    </Link>
  )
}

/** Under 5 ratings in the range: what unlocks the stats, and a faded preview. */
function WarmingUp({ total, isOwn, handle }: { total: number; isOwn: boolean; handle: string }) {
  const left = STATS_MIN_RATINGS - total
  return (
    <div className="flex flex-col gap-3.5 md:col-span-12">
      <Card className="flex flex-col items-center gap-3 px-6 py-9 text-center">
        <BeatieImage mood="thinking" size={112} />
        {isOwn ? (
          <>
            <p className="text-section-title">Your stats are warming up</p>
            <p className="max-w-xs text-body text-muted-foreground">
              Rate {left} more {left === 1 ? 'song' : 'songs'} and Beatie will show your top genres, artists and
              favourite decade.
            </p>
          </>
        ) : (
          <p className="max-w-xs text-body text-foreground" dir="auto">
            {handle} needs a few more ratings before their stats show up.
          </p>
        )}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STATS_MIN_RATINGS}
          aria-valuenow={total}
          aria-label={`${total} of ${STATS_MIN_RATINGS} ratings`}
          className="mt-1 h-2 w-56 overflow-hidden rounded-full bg-surface-2"
        >
          <span className="block h-full rounded-full bg-primary" style={{ width: `${(total / STATS_MIN_RATINGS) * 100}%` }} />
        </div>
        <small className="text-meta text-muted-foreground">
          {total} of {STATS_MIN_RATINGS} ratings
        </small>
        {isOwn && (
          <Link to="/explore" className={cn(emptyActionClass, 'w-full max-w-xs')}>
            Find songs to rate
          </Link>
        )}
      </Card>
      {/* A faded preview of what's coming: decoration only. */}
      <Card aria-hidden className="pointer-events-none opacity-30 grayscale-[0.4]">
        <div className="mb-3 h-4 w-28 rounded bg-surface-2" />
        {[90, 70, 55, 40].map((w, i) => (
          <div key={i} className="flex h-11 items-center gap-3">
            <span className="w-24 text-meta text-muted-foreground">· · ·</span>
            <span className="h-3 flex-1 rounded-r bg-white/5">
              <span className={cn('block h-full rounded-r', i === 0 ? 'bg-primary' : 'bg-primary/45')} style={{ width: `${w}%` }} />
            </span>
          </div>
        ))}
      </Card>
    </div>
  )
}

/** The body's layout in outline, while a range loads. */
function StatsSkeleton() {
  return (
    <div className="contents" aria-busy="true" role="status">
      <span className="sr-only">Loading stats…</span>
      <Skeleton tone="page" className="h-[70px] rounded-card md:col-span-7" />
      <div className="grid grid-cols-2 gap-2.5 md:col-span-12 md:grid-cols-4 md:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} tone="page" className="h-[78px] rounded-card" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <Card key={i} shadow={false} className="md:col-span-6">
          <Skeleton className="mb-2 h-4 w-32" />
          <Skeleton className="mb-4 h-3 w-40" />
          <div className="flex h-36 items-end gap-2">
            {[40, 65, 90, 75, 50].map((h, j) => (
              <Skeleton key={j} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

/** Every artist rated in the range, most rated first. */
function AllArtistsSheet({
  open,
  onClose,
  userId,
  range,
}: {
  open: boolean
  onClose: () => void
  userId: string
  range: StatsRange
}) {
  const titleId = useId()
  const [artists, setArtists] = useState<StatsArtist[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setArtists(null)
    setFailed(false)
    getAllRatedArtists(userId, range)
      .then((a) => !cancelled && setArtists(a))
      .catch((err) => {
        console.error('[beatboxed] rated artists failed:', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, userId, range])

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center gap-2 px-5 pb-2 pt-3 sm:pt-5">
        <h2 id={titleId} className="flex-1 text-section-title">
          Most rated artists
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-3 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="overflow-y-auto px-5 pb-5">
        {failed ? (
          <p className="py-6 text-center text-body text-danger">Couldn't load the list.</p>
        ) : artists === null ? (
          <SkeletonList rows={5} cover="size-11 rounded-full" />
        ) : (
          <ol className="flex flex-col gap-1">
            {artists.map((a, i) => (
              <li key={a.id}>
                <Link
                  to={`/artist/${a.id}`}
                  onClick={onClose}
                  className="flex min-h-14 items-center gap-3 rounded-inset px-2 py-1.5 transition-colors duration-200 ease-soft hover:bg-surface-2"
                >
                  <span className="w-6 shrink-0 text-end text-meta text-muted-foreground">{i + 1}</span>
                  {a.photo ? (
                    <img src={a.photo} alt="" loading="lazy" className="size-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span dir="auto" className="min-w-0 flex-1 truncate text-card-title">
                    {a.name}
                  </span>
                  <span className="shrink-0 text-meta text-muted-foreground">
                    {a.count} {a.count === 1 ? 'song' : 'songs'} · <span className="text-star">{a.average.toFixed(1)}★</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}
