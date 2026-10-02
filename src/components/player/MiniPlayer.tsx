import { Link } from 'react-router-dom'
import { Disc3, Loader2, Pause, Play, SkipForward } from 'lucide-react'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/cn'

/**
 * Slim bar once something is playing. Sits above the bottom nav on phones and
 * along the bottom on desktop. AppShell adds matching bottom padding so the
 * page never hides behind it.
 */
export function MiniPlayer() {
  const { current, isPlaying, loading, unavailable, position, duration, toggle, next } =
    usePlayer()

  if (!current) return null
  const pct = duration > 0 ? (position / duration) * 100 : 0

  return (
    <div
      className="fixed inset-x-0 bottom-[68px] z-30 border-t border-white/5 bg-surface/95 backdrop-blur-xl md:bottom-0 md:left-20 lg:left-60"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="h-0.5 w-full bg-white/5">
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <Link to="/now-playing" className="flex min-w-0 flex-1 items-center gap-3">
          <span className="size-10 shrink-0 overflow-hidden rounded-[8px]">
            {current.coverUrl ? (
              <img src={current.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center bg-surface-2">
                <Disc3 className="size-5 text-muted-foreground" strokeWidth={1.5} />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span dir="auto" className="truncate text-secondary text-foreground">
              {current.title}
            </span>
            <span dir="auto" className="truncate text-meta text-muted-foreground">
              {unavailable ? 'Preview unavailable' : current.artistName}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => toggle()}
          disabled={loading || unavailable}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full text-foreground transition-all duration-200 ease-soft hover:bg-white/5 active:scale-95',
            (loading || unavailable) && 'opacity-40'
          )}
        >
          {loading ? (
            <Loader2 className="size-5 animate-spin" strokeWidth={2} aria-hidden />
          ) : isPlaying ? (
            <Pause className="size-5 fill-current" strokeWidth={2} />
          ) : (
            <Play className="size-5 translate-x-px fill-current" strokeWidth={2} />
          )}
        </button>

        <button
          type="button"
          onClick={next}
          aria-label="Next"
          className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <SkipForward className="size-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
