import { Star } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Five stars with a fractional fill, so 4.3 reads as 4.3 rather than rounding.
 * The filled row is clipped over the outline row by percentage width.
 */
export function StarRating({
  value,
  size = 16,
  className,
}: {
  value: number
  size?: number
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, value / 5)) * 100

  const row = (filled: boolean) => (
    <span className="flex shrink-0" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          strokeWidth={1.75}
          className={cn(
            'shrink-0',
            filled ? 'fill-star text-star' : 'text-muted-foreground/40'
          )}
        />
      ))}
    </span>
  )

  return (
    <span
      className={cn('relative inline-flex', className)}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {row(false)}
      <span
        className="absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${pct}%` }}
      >
        {row(true)}
      </span>
    </span>
  )
}
