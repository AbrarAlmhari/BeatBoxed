import { tintFor } from '@/components/explore/tint'
import { cn } from '@/lib/cn'

/**
 * A playlist's artwork. An uploaded cover wins; otherwise it's derived — a
 * 2x2 grid of the first four songs' covers, one cover filling the square for
 * 1-3 songs, and the same gradient placeholder the rest of the app uses when
 * there's nothing to show.
 *
 * A playlist whose songs happen to have no album art falls back to the
 * gradient too, so a card is never a grid of grey boxes.
 */
export function PlaylistCover({
  covers,
  seed,
  customUrl,
  className,
}: {
  covers: string[]
  /** Keeps a given playlist's placeholder hue stable between renders. */
  seed: string
  /** An uploaded cover. Wins over the derived grid wherever one is set. */
  customUrl?: string | null
  className?: string
}) {
  const tint = tintFor(seed)
  const shell = cn('relative aspect-square w-full overflow-hidden rounded-[10px]', className)

  if (customUrl) {
    return (
      <div className={shell}>
        <img
          src={customUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    )
  }

  if (covers.length === 0) {
    return (
      <div
        className={shell}
        style={{
          background: `linear-gradient(135deg,
            color-mix(in oklab, var(--color-primary) ${18 + tint * 55}%, var(--color-surface-2)),
            color-mix(in oklab, var(--color-accent) ${10 + tint * 40}%, var(--color-background)))`,
        }}
      />
    )
  }

  if (covers.length < 4) {
    return (
      <div className={shell}>
        <img
          src={covers[0]}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className={cn(shell, 'grid grid-cols-2 grid-rows-2')}>
      {covers.slice(0, 4).map((url, i) => (
        <img
          key={`${url}-${i}`}
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ))}
    </div>
  )
}
