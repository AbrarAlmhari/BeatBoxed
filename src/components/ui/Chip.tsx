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
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-button',
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
