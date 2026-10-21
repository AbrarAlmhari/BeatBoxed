import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { prefersReducedMotion } from '@/lib/scroll'

/**
 * A row that scrolls sideways: song rails, chip filters.
 *
 * Phones swipe it, as before. With a mouse, arrow buttons appear at its
 * edges on hover, only when the row is wider than the screen and only on
 * the side there is more to see; each click moves about one row-width,
 * still snapping to the items. Shift+wheel and trackpad swipes scroll it
 * natively. Keyboard users Tab into it and move with the arrow keys, so the
 * buttons are for the mouse only and stay out of the tab order.
 */
export function ScrollRow({
  as: Tag = 'ul',
  size = 'md',
  arrowTop = 'top-1/2',
  className,
  children,
  ...rest
}: {
  as?: 'ul' | 'ol' | 'div'
  /** md for song cards, sm for chips. */
  size?: 'md' | 'sm'
  /** Where the arrows sit, e.g. level with the covers rather than the whole card. */
  arrowTop?: string
  className?: string
  children: ReactNode
} & HTMLAttributes<HTMLElement>) {
  const row = useRef<HTMLElement | null>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = row.current
    if (!el) return
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = row.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [measure, children])

  function page(direction: 1 | -1) {
    const el = row.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  // Left/right arrow keys move between the row's items.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const el = row.current
    const target = e.target as HTMLElement
    if (!el || target.closest('input, textarea, [role="slider"]')) return
    const items = Array.from(el.children) as HTMLElement[]
    const at = items.findIndex((item) => item.contains(target))
    const next = items[at + (e.key === 'ArrowRight' ? 1 : -1)]
    const focusable = next?.matches('a, button')
      ? next
      : next?.querySelector<HTMLElement>('a[href], button:not([disabled])')
    if (!focusable) return
    e.preventDefault()
    focusable.focus()
  }

  const arrow = cn(
    'absolute z-10 hidden -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface/95 text-foreground shadow-raised backdrop-blur',
    'opacity-0 transition-opacity duration-200 ease-soft group-hover/row:opacity-100 hover:bg-surface-2',
    // Mouse and trackpad only; phones and tablets keep swiping.
    'pointer-fine:grid',
    size === 'md' ? 'size-10' : 'size-8',
    arrowTop
  )
  const icon = size === 'md' ? 'size-5' : 'size-4'

  return (
    <div className="group/row relative min-w-0" data-scroll-row>
      <Tag
        {...rest}
        ref={(el: HTMLElement | null) => {
          row.current = el
        }}
        onKeyDown={onKeyDown}
        className={className}
      >
        {children}
      </Tag>
      {canLeft && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-row-arrow="left"
          onClick={() => page(-1)}
          className={cn(arrow, '-left-1 sm:-left-3')}
        >
          <ChevronLeft className={icon} strokeWidth={2} />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-row-arrow="right"
          onClick={() => page(1)}
          className={cn(arrow, '-right-1 sm:-right-3')}
        >
          <ChevronRight className={icon} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
