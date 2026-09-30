import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Interactive 1–5 selector. Hover previews a value without committing it;
 * click commits. Radio inputs under the hood so keyboard and screen readers
 * get real semantics rather than a pile of divs.
 */
export function StarInput({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (next: number) => void
  disabled?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value

  return (
    <fieldset
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
      disabled={disabled}
    >
      <legend className="sr-only">Rating out of 5</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          onMouseEnter={() => setHover(n)}
          className={cn(
            'rounded p-0.5',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary'
          )}
        >
          <input
            type="radio"
            name="rating"
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            disabled={disabled}
            className="sr-only"
          />
          <span className="sr-only">{n} star{n > 1 ? 's' : ''}</span>
          <Star
            aria-hidden
            className={cn(
              'size-7 transition-colors duration-200 ease-soft',
              n <= shown
                ? 'fill-star text-star'
                : 'text-muted-foreground/40 hover:text-muted-foreground'
            )}
            strokeWidth={1.75}
          />
        </label>
      ))}
    </fieldset>
  )
}
