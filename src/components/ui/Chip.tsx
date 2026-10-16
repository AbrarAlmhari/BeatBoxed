import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Toggle chip, for filters within one list. Active = white text on a
 * low-opacity purple field with a purple border; inactive = muted text on the
 * surface colour, per docs/design-system.md. To switch between views, use
 * Tabs instead.
 */
export function Chip({
  active = false,
  onClick,
  children,
  touchTarget = true,
}: {
  active?: boolean
  /** Without one the chip is a plain label (an artist's genres), not a button. */
  onClick?: () => void
  children: ReactNode
  /**
   * Extend the tap area to 44px tall without changing how the chip looks
   * (an invisible ::after above and below it). On by default; turn it off
   * only where chips wrap onto rows closer than 8px apart.
   */
  touchTarget?: boolean
}) {
  if (!onClick) {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-chip border border-line-strong bg-surface-2 px-3 py-1 text-meta text-muted-foreground">
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-chip border px-3.5 py-1.5 text-button',
        touchTarget && 'tap-44 relative',
        'transition-colors duration-200 ease-soft active:scale-[0.97]',
        active
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-transparent bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
