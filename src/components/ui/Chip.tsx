import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Toggle chip. Active = white text on a low-opacity purple field with a purple
 * border; inactive = #A1A1AA on the surface colour, per docs/design-system.md.
 */
export function Chip({
  active,
  onClick,
  children,
  touchTarget = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  /**
   * Extend the tap area to 44px tall without changing how the chip looks
   * (an invisible ::after above and below it).
   */
  touchTarget?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-button',
        touchTarget && "relative after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
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
