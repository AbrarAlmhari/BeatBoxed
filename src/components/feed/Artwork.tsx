import { Disc3 } from 'lucide-react'
import { tintFor } from '@/components/explore/tint'
import { cn } from '@/lib/cn'

/**
 * Album art, or the same soft purple placeholder the profile's review cards
 * use when a song has none. Size it with className.
 */
export function Artwork({
  src,
  seed,
  className,
}: {
  src: string | null | undefined
  /** Keeps a song's placeholder the same colour everywhere it appears. */
  seed: string
  className?: string
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn('shrink-0 rounded-[10px] object-cover', className)}
      />
    )
  }
  const t = tintFor(seed)
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[10px]', className)}
      style={{
        background: `linear-gradient(135deg,
          color-mix(in oklab, var(--color-primary) ${20 + t * 50}%, var(--color-surface-2)),
          color-mix(in oklab, var(--color-accent) ${12 + t * 38}%, var(--color-background)))`,
      }}
    >
      <Disc3 className="size-5 text-white/70" strokeWidth={1.5} />
    </span>
  )
}
