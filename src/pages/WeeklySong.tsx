import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Pause, Play, Star } from 'lucide-react'
import { Artwork } from '@/components/feed/Artwork'
import { ReviewComposer } from '@/components/feed/ReviewComposer'
import { PersonAvatar } from '@/components/conversations/PersonAvatar'
import { PageGlow } from '@/components/ui/PageGlow'
import { StarInput } from '@/components/ui/StarInput'
import { StarRating } from '@/components/ui/StarRating'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { COVER_FALLBACK, useCoverColors } from '@/lib/coverColors'
import { getWeeklySong, setMyRating, weekRange, type WeeklySong as Week } from '@/lib/mood'

const REASON: Record<Week['reason'], string> = {
  most_rated: 'Chosen because it was the most-rated new song last week',
  trending: 'Chosen from what’s trending, since no song had enough new ratings last week',
}

/**
 * The song of the week (#10): why it was chosen, your rating (tap a star;
 * Add a review opens the usual composer on this song), the community
 * average with its 5-to-1 bars, what people are saying (only people you
 * may see and haven't muted), and past weeks.
 */
export default function WeeklySong() {
  const { user } = useAuth()
  const player = usePlayer()
  const toast = useToast()
  const [week, setWeek] = useState<Week | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [writing, setWriting] = useState(false)
  const colors = useCoverColors(week?.song.coverUrl)

  const load = useCallback(async () => {
    try {
      setWeek(await getWeeklySong())
    } catch (err) {
      console.error('[beatboxed] song of the week failed:', err)
      setWeek(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function rate(stars: number) {
    if (!user || !week) return
    const before = week.myRating
    setWeek({ ...week, myRating: stars })
    setSaving(true)
    try {
      await setMyRating(week.song.id, user.id, stars)
      await load()
    } catch (err) {
      console.error('[beatboxed] rating failed:', err)
      setWeek((w) => w && { ...w, myRating: before })
      toast.show({ message: "Couldn't save your rating. Try again." })
    } finally {
      setSaving(false)
    }
  }

  if (week === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pt-2" aria-busy="true">
        <Skeleton tone="page" className="h-40 rounded-card" />
        <Skeleton tone="page" className="h-28 rounded-card" />
        <Skeleton tone="page" className="h-44 rounded-card" />
      </div>
    )
  }
  if (week === null) {
    return <EmptyState face="sleepy-sticker" title="No song this week yet" detail="Check back soon." />
  }

  const s = week.song
  const isCurrent = player.current?.id === s.id
  const playing = isCurrent && player.isPlaying
  const max = Math.max(1, ...Object.values(week.distribution))

  return (
    <div className="relative isolate">
      <PageGlow strength="hero" colors={colors ?? COVER_FALLBACK} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pt-2">
        <p className="text-meta font-bold uppercase tracking-[0.12em] text-week">
          Song of the week · {weekRange(week.weekStart, week.weekEnd)}
        </p>

        <header className="flex items-center gap-4">
          <div className="relative w-32 shrink-0 sm:w-40">
            <Artwork src={s.coverUrl} seed={s.id} className="aspect-square size-full rounded-card shadow-[0_12px_40px_rgb(0_0_0/0.45)]" />
            <button
              type="button"
              onClick={() =>
                isCurrent
                  ? player.toggle()
                  : player.playQueue([{ id: s.id, title: s.title, artistName: s.artistName, coverUrl: s.coverUrl, ratingAvg: week.average, reviewCount: week.ratings }], 0)
              }
              aria-label={playing ? `Pause ${s.title}` : `Play ${s.title}`}
              className="absolute bottom-2 right-2 grid size-11 place-items-center rounded-full bg-primary text-white shadow-raised transition-colors duration-200 ease-soft hover:bg-accent"
            >
              {isCurrent && player.loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : playing ? (
                <Pause className="size-4 fill-current" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} />
              )}
            </button>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Link to={`/song/${s.id}`} dir="auto" className="text-page-title transition-colors duration-200 ease-soft hover:text-accent">
              {s.title}
            </Link>
            {s.artistId ? (
              <Link to={`/artist/${s.artistId}`} className="w-fit text-body text-muted-foreground hover:text-foreground">
                {s.artistName}
              </Link>
            ) : (
              <p className="text-body text-muted-foreground">{s.artistName}</p>
            )}
            <p className="text-secondary text-muted-foreground">{REASON[week.reason]}</p>
          </div>
        </header>

        <section aria-label="Your rating" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <h2 className="text-card-title text-foreground/90">
            {week.myRating ? `You rated it ${week.myRating} ${week.myRating === 1 ? 'star' : 'stars'}` : "You haven't rated it yet"}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <StarInput value={week.myRating ?? 0} onChange={(n) => void rate(n)} disabled={saving} />
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="ml-auto min-h-11 rounded-chip bg-primary/25 px-5 text-button text-accent transition-colors duration-200 ease-soft hover:bg-primary/35"
            >
              {week.myRating ? 'Edit your review' : 'Add a review'}
            </button>
          </div>
        </section>

        <section aria-label="Community rating" className="flex items-center gap-6 rounded-card border border-line bg-surface p-5">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span className="text-[44px] font-bold leading-none">{week.average !== null ? week.average.toFixed(1) : '–'}</span>
            <StarRating value={Math.round(week.average ?? 0)} size={14} />
            <span className="text-secondary text-muted-foreground">
              {week.ratings} {week.ratings === 1 ? 'rating' : 'ratings'}
            </span>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5" aria-label="Ratings by stars">
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <li key={n} className="flex items-center gap-3 text-secondary text-muted-foreground">
                <span className="w-3 text-right">{n}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <span className="block h-full rounded-full bg-star" style={{ width: `${(week.distribution[n] / max) * 100}%` }} />
                </span>
                <span className="w-6 text-right" aria-label={`${week.distribution[n]} ${n}-star ratings`}>
                  {week.distribution[n]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="week-saying" className="flex flex-col gap-3">
          <h2 id="week-saying" className="text-card-title text-foreground/90">
            What people are saying
          </h2>
          {week.topReviews.length === 0 ? (
            <p className="text-body text-muted-foreground">No reviews yet. Be the first to say what you hear in it.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {week.topReviews.map((r) => {
                const name = r.person.displayName || r.person.username || 'Someone'
                return (
                  <li key={r.id} className="flex gap-3 rounded-card bg-surface p-4">
                    <Link to={`/profile/${r.userId}`} aria-hidden tabIndex={-1}>
                      <PersonAvatar name={name} url={r.person.avatarUrl} className="size-10 text-secondary" />
                    </Link>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link to={`/profile/${r.userId}`} dir="auto" className="text-card-title hover:text-accent">
                          {name}
                        </Link>
                        <StarRating value={r.rating} size={13} />
                      </p>
                      <Link
                        to={`/song/${s.id}?review=${r.id}`}
                        dir="auto"
                        className="line-clamp-3 text-body text-foreground/90 hover:text-foreground"
                      >
                        {r.title ? <span className="font-semibold">{r.title} </span> : null}
                        {r.body}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {week.pastWeeks.length > 0 && (
          <section aria-labelledby="week-past" className="flex flex-col gap-3">
            <h2 id="week-past" className="text-card-title text-foreground/90">
              Past weeks
            </h2>
            <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {week.pastWeeks.map((w) => (
                <li key={w.weekStart} className="w-40 shrink-0">
                  <Link to={`/song/${w.songId}`} className="flex flex-col gap-2">
                    <Artwork src={w.coverUrl} seed={w.songId} className="aspect-[4/3] w-full rounded-card" />
                    <span dir="auto" className="truncate text-card-title">
                      {w.title}
                    </span>
                    <span className="text-secondary text-muted-foreground">
                      {weekRange(w.weekStart, w.weekEnd)}
                      {w.average !== null && (
                        <>
                          {' · '}
                          <Star className="inline size-3.5 fill-current align-[-2px]" strokeWidth={0} aria-hidden /> {w.average.toFixed(1)}
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ReviewComposer
        open={writing}
        onClose={() => setWriting(false)}
        initialSong={{
          id: s.id,
          title: s.title,
          artistName: s.artistName,
          coverUrl: s.coverUrl,
          ratingAvg: week.average,
          reviewCount: week.ratings,
          artistId: s.artistId,
        }}
        onPosted={() => {
          setWriting(false)
          void load()
        }}
      />
    </div>
  )
}
