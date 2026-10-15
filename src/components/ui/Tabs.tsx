import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'

export type TabItem<T extends string> = { id: T; label: ReactNode }

export const tabIdFor = (prefix: string, id: string) => `${prefix}-tab-${id}`
export const panelIdFor = (prefix: string, id: string) => `${prefix}-panel-${id}`

/**
 * Underlined tabs, 48px tall, the profile's look. A real tablist: arrow keys
 * move between tabs, Home and End jump, and only the selected tab is in the
 * Tab order.
 *
 * - `sticky` keeps the bar under the top bar once scrolled past, on the
 *   see-through blurred bar. `stickyTop` is where it stops (the profile,
 *   whose phone top bar is its own, uses `top-0 md:top-16`).
 * - `fill` shares the width between tabs on phones; on desktop they sit
 *   left at their natural width.
 * - Pair with <TabPanel> using the same `idPrefix`.
 * - For a tab in the URL (?tab=), use useTabParam below.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  sticky = false,
  stickyTop = 'top-16',
  fill = true,
  className,
}: {
  tabs: TabItem<T>[]
  value: T
  onChange: (next: T) => void
  /** Names the tablist for screen readers. */
  label: string
  idPrefix: string
  sticky?: boolean
  stickyTop?: string
  fill?: boolean
  className?: string
}) {
  const refs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const id = tabs[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div
      className={cn(
        'border-b border-line-strong',
        sticky && cn('glass-bar sticky z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8', stickyTop),
        className
      )}
    >
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex md:gap-2">
        {tabs.map((t) => {
          const active = t.id === value
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={tabIdFor(idPrefix, t.id)}
              aria-selected={active}
              aria-controls={panelIdFor(idPrefix, t.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                '-mb-px min-h-12 border-b-2 text-button transition-colors duration-200 ease-soft',
                fill ? 'flex-1 md:flex-none md:px-5' : 'px-4 md:px-5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The panel for the selected tab. Keyed on the tab, so switching replays the
 * page's entrance fade (off with reduced motion).
 */
export function TabPanel({
  idPrefix,
  value,
  className,
  children,
}: {
  idPrefix: string
  value: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      key={value}
      role="tabpanel"
      id={panelIdFor(idPrefix, value)}
      aria-labelledby={tabIdFor(idPrefix, value)}
      tabIndex={0}
      className={cn('animate-page-in focus-visible:outline-none motion-reduce:animate-none', className)}
    >
      {children}
    </div>
  )
}

/**
 * A tab kept in the URL (`?tab=`), so links and Back work. Changing tabs is
 * a history entry; other params are kept. The default tab has no param.
 */
export function useTabParam<T extends string>(ids: readonly T[], fallback: T, param = 'tab') {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param)
  const value = ids.includes(raw as T) ? (raw as T) : fallback
  const set = useCallback(
    (next: T) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev)
        if (next === fallback) p.delete(param)
        else p.set(param, next)
        return p
      }),
    [setParams, fallback, param]
  )
  return [value, set] as const
}

/**
 * A two- or three-way switch inside one view (Songs / Reviews, Artwork /
 * Lyrics): toggle buttons in a small card, not tabs.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { id: T; label: ReactNode }[]
  value: T
  onChange: (next: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex w-full max-w-xs gap-1 self-start rounded-card border border-line-strong bg-surface p-1',
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'min-h-11 flex-1 rounded-button text-button transition-colors duration-200 ease-soft',
            value === o.id
              ? 'border border-primary/60 bg-primary/15 text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
