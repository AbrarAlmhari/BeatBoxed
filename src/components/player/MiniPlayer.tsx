import { Link } from 'react-router-dom'
import { Disc3, Loader2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/cn'

/**
 * Slim bar once something is playing. Sits above the bottom nav on phones and
 * along the bottom on desktop. AppShell adds matching bottom padding so the
 * page never hides behind it.
 */
export function MiniPlayer() {
  const {
    current,
    isPlaying,
    loading,
    unavailable,
    skipNotice,
    position,
    duration,
    toggle,
    next,
    previous,
    stop,
  } = usePlayer()

  if (!current) return null
  const pct = duration > 0 ? (position / duration) * 100 : 0

  return (
    <div
      // A named region: the bar holds several links now, so "the mini
      // player" needs a handle of its own for assistive tech and tests.
      role="region"
      aria-label="Mini player"
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
        {/* Cover and title open Now Playing; the artist line is its own link
            to the artist page. They're siblings rather than nested, because
            an anchor inside an anchor is invalid and the browser drops it. */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to="/now-playing"
            aria-label="Now playing"
            className="size-10 shrink-0 overflow-hidden rounded-[8px]"
          >
            {current.coverUrl ? (
              <img src={current.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center bg-surface-2">
                <Disc3 className="size-5 text-muted-foreground" strokeWidth={1.5} />
              </span>
            )}
          </Link>
          <span className="flex min-w-0 flex-col">
            <Link
              to="/now-playing"
              dir="auto"
              className="truncate text-secondary text-foreground"
            >
              {current.title}
            </Link>
            {/* The skip notice takes the artist's place rather than adding a
                row, so the bar doesn't change height mid-queue. */}
            {skipNotice ? (
              <span className="truncate text-meta text-muted-foreground">
                {skipNotice}
              </span>
            ) : unavailable ? (
              <span className="truncate text-meta text-muted-foreground">
                Preview unavailable
              </span>
            ) : current.artistId ? (
              <Link
                to={`/artist/${current.artistId}`}
                dir="auto"
                className="truncate text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                {current.artistName}
              </Link>
            ) : (
              <span dir="auto" className="truncate text-meta text-muted-foreground">
                {current.artistName}
              </span>
            )}
          </span>
        </div>

        {/* Hidden on the narrowest phones, where four controls and the title
            leave the title no room. Now Playing still has it there. */}
        <button
          type="button"
          onClick={previous}
          aria-label="Previous"
          className="hidden size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95 min-[380px]:grid"
        >
          <SkipBack className="size-5" strokeWidth={2} />
        </button>

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

        {/* Stops playback and unmounts the bar: stop() clears the queue, and
            this component renders nothing without a current track. Separated
            by a hairline so it doesn't read as another transport control —
            it's the one button here that ends the session. */}
        <button
          type="button"
          onClick={stop}
          aria-label="Close player"
          title="Stop and close the player"
          className="ms-1 grid size-10 shrink-0 place-items-center rounded-full border-s border-white/5 ps-1 text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <X className="size-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
