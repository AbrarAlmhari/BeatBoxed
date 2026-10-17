import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Loader2, Pause, Play, Star } from 'lucide-react'
import { Artwork } from '@/components/feed/Artwork'
import { AvatarStack } from '@/components/conversations/PersonAvatar'
import { usePlayer } from '@/lib/player'
import { cardGlowStyle, useCoverColors } from '@/lib/coverColors'
import { daysLeft, getWeeklySong, type WeeklySong } from '@/lib/mood'

/**
 * Home's song of the week (#10): one song for everyone this week, how long
 * is left, whether it suits you, how it's rated, who you follow rated it,
 * and a way to rate it. Asking for it chooses it if nobody has this week.
 */
export function WeeklySongCard() {
  const player = usePlayer()
  const navigate = useNavigate()
  const [week, setWeek] = useState<WeeklySong | null | undefined>(undefined)
  const colors = useCoverColors(week?.song.coverUrl)

  useEffect(() => {
    let live = true
    getWeeklySong()
      .then((w) => live && setWeek(w))
      .catch((err) => {
        console.warn('[beatboxed] song of the week failed:', err)
        if (live) setWeek(null)
      })
    return () => {
      live = false
    }
  }, [])

  if (!week) return null
  const s = week.song
  const isCurrent = player.current?.id === s.id
  const playing = isCurrent && player.isPlaying
  const left = daysLeft(week.weekEnd)
  const track = { id: s.id, title: s.title, artistName: s.artistName, coverUrl: s.coverUrl, ratingAvg: week.average, reviewCount: week.ratings }

  return (
    <section
      aria-label="Song of the week"
      style={cardGlowStyle(colors)}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <Link to="/week" className="text-meta font-bold uppercase tracking-[0.12em] text-week hover:text-foreground">
          Song of the week
        </Link>
        <span className="text-meta font-semibold text-muted-foreground">
          {left <= 1 ? 'Ends today' : `Ends in ${left} days`}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Link to="/week" className="w-28 shrink-0 sm:w-32" aria-hidden tabIndex={-1}>
          <Artwork
            src={s.coverUrl}
            seed={s.id}
            className="aspect-square size-full rounded-card shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
          />
        </Link>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link to="/week" dir="auto" className="text-[22px] font-bold leading-tight transition-colors duration-200 ease-soft hover:text-accent">
            {s.title}
          </Link>
          <p className="truncate text-body text-muted-foreground">{s.artistName}</p>
          {week.matchesTaste && (
            <span className="flex w-fit items-center gap-1.5 rounded-chip bg-primary/25 px-3 py-1 text-meta font-semibold text-accent">
              <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
              Matches your taste
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body">
        {week.average !== null && (
          <span className="flex items-center gap-1">
            <Star className="size-4 fill-star text-star" strokeWidth={0} aria-hidden />
            <span className="font-semibold text-star">{week.average.toFixed(1)}</span>
            <span className="text-muted-foreground">average</span>
          </span>
        )}
        <span className="text-muted-foreground">
          {week.ratings} {week.ratings === 1 ? 'rating' : 'ratings'}
        </span>
        {week.followedRaterCount > 0 && (
          <span className="ml-auto flex items-center gap-2 text-muted-foreground">
            <AvatarStack
              people={week.followedRaters.slice(0, 2).map((p) => ({
                id: p.id,
                name: p.displayName || p.username || '?',
                avatarUrl: p.avatarUrl,
              }))}
            />
            {week.followedRaterCount} you follow
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (isCurrent ? player.toggle() : player.playQueue([track], 0))}
          aria-label={playing ? `Pause ${s.title}` : `Play ${s.title}`}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
        >
          {isCurrent && player.loading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-5 fill-current" strokeWidth={0} />
          ) : (
            <Play className="ml-0.5 size-5 fill-current" strokeWidth={0} />
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate('/week')}
          className="min-h-14 flex-1 rounded-chip bg-primary text-button text-white shadow-[0_8px_28px_rgb(139_92_246/0.4)] transition-colors duration-200 ease-soft hover:bg-accent"
        >
          {week.myRating ? `You rated it ${week.myRating}★ · See the week` : "Rate this week's song"}
        </button>
      </div>
    </section>
  )
}
