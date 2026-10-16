import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type StatsBar = {
  key: string
  /** Under the bar (the x-axis). */
  label: ReactNode
  /** Said in full to screen readers and in the table ("4 stars", "1990s"). */
  name: string
  value: number
  /** The tooltip's lines, e.g. ["4★ · 51 songs", "40% of your ratings"]. */
  tip: [string, string]
}

const PLOT = 112 // px, the tallest bar

/**
 * Vertical bars with the number on top and a label underneath. The tallest
 * bar is full accent, the rest softer, and every bar carries its number, so
 * nothing relies on colour alone.
 *
 * - Bars grow in the first time they're drawn (not with reduced motion) and
 *   ease between values when the data changes.
 * - Hover or focus shows a small tooltip; a tap shows it for a moment.
 * - Each bar is a button, the full height of the chart (well over 44px).
 * - A visually hidden table carries the same numbers for screen readers.
 */
export function StatsBarChart({ bars, caption }: { bars: StatsBar[]; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  const topIndex = bars.findIndex((b) => b.value === max && b.value > 0)
  const [grown, setGrown] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const tableId = useId()

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true))
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(hideTimer.current)
    }
  }, [])

  const cols = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }

  return (
    <div className="relative">
      <div className="relative grid h-40 items-end gap-2 pt-6" style={cols} aria-describedby={tableId}>
        {bars.map((b, i) => {
          const top = i === topIndex
          const h = b.value === 0 ? 3 : Math.max(3, (b.value / max) * PLOT)
          return (
            <button
              key={b.key}
              type="button"
              aria-label={`${b.name}: ${b.value} ${b.value === 1 ? 'song' : 'songs'}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              onClick={() => {
                setActive(i)
                clearTimeout(hideTimer.current)
                hideTimer.current = setTimeout(() => setActive((a) => (a === i ? null : a)), 1800)
              }}
              className="group relative flex h-full min-w-0 flex-col items-center justify-end gap-1.5 rounded-thumb focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                className={cn(
                  'text-meta tabular-nums',
                  top ? 'font-bold text-foreground' : 'text-muted-foreground'
                )}
              >
                {b.value}
              </span>
              <span
                aria-hidden
                className={cn(
                  'block w-full max-w-11 rounded-t-[4px] transition-[height,background-color] duration-700 ease-soft motion-reduce:transition-none',
                  top ? 'bg-primary' : 'bg-primary/45 group-hover:bg-primary/60'
                )}
                style={{ height: grown ? h : 0 }}
              />
              {active === i && (
                <span
                  role="status"
                  className="animate-fade-in pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-inset border border-line-strong bg-surface-2 px-2.5 py-1.5 text-left text-meta shadow-raised motion-reduce:animate-none"
                >
                  <b className="block text-secondary text-foreground">{b.tip[0]}</b>
                  <span className="text-muted-foreground">{b.tip[1]}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 grid gap-2 border-t border-line pt-2" style={cols} aria-hidden>
        {bars.map((b) => (
          <span key={b.key} className="truncate text-center text-meta font-semibold text-muted-foreground">
            {b.label}
          </span>
        ))}
      </div>

      <table id={tableId} className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.name}</th>
              <td>{b.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
