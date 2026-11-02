import { useState } from 'react'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { Sheet } from './Sheet'
import { cn } from '@/lib/cn'

export type FilterOption = {
  value: string
  label: string
  /** A count at the row's end (see the section's `counts`); nothing when null or 0. */
  count?: number | null
}

export type FilterSection = {
  /** Shown above the rows when there's more than one section ("Show", "Sort by"). */
  title: string
  options: FilterOption[]
  value: string
  /** What Clear goes back to, and what counts as "not filtered". */
  defaultValue: string
  onChange: (next: string) => void
  /** `unread`: purple badges, read out as "3 unread". `total` (default): a quiet number. */
  counts?: 'unread' | 'total'
}

/**
 * The app's one way to filter or sort a list: a button that opens a bottom
 * sheet on phones (a menu under the button on a computer) with each section
 * as one-choice rows. A tap applies the choice and closes it.
 *
 * - `face="icon"`: the sliders icon, with a dot while anything isn't on its
 *   default. The page says what's showing (Notifications' "Showing: …").
 * - `face="value"`: the first section's current choice as text ("Songs ⌄"),
 *   so it reads at a glance.
 * - `clearLabel` adds a row that puts every section back to its default,
 *   shown only while something isn't.
 */
export function FilterButton({
  title,
  sections,
  face = 'icon',
  clearLabel,
  className,
}: {
  /** Titles the sheet and names the button for screen readers. */
  title: string
  sections: FilterSection[]
  face?: 'icon' | 'value'
  clearLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const chosen = (s: FilterSection) => s.options.find((o) => o.value === s.value) ?? s.options[0]
  const changed = sections.filter((s) => s.value !== s.defaultValue)
  const several = sections.length > 1

  // Says what the dot or the face shows: "Filter notifications, showing
  // Mentions"; the value face's text leads its name ("Filter results: Songs").
  const name =
    face === 'value'
      ? `${title}: ${chosen(sections[0]).label}`
      : changed.length
        ? `${title}, showing ${changed.map((s) => chosen(s).label).join(', ')}`
        : title

  function pick(s: FilterSection, value: string) {
    if (value !== s.value) s.onChange(value)
    setOpen(false)
  }

  function clear() {
    for (const s of changed) s.onChange(s.defaultValue)
    setOpen(false)
  }

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'relative rounded-button border border-line-strong bg-surface-2 text-foreground transition-colors duration-200 ease-soft hover:bg-white/10',
          face === 'icon'
            ? 'grid size-11 place-items-center'
            : 'inline-flex min-h-11 items-center gap-1.5 pl-3.5 pr-2.5 text-button'
        )}
      >
        {face === 'icon' ? (
          <>
            <SlidersHorizontal className="size-5" strokeWidth={2} aria-hidden />
            {changed.length > 0 && (
              <span
                data-filter-dot
                aria-hidden
                className="absolute right-2 top-2 size-2.5 rounded-full bg-primary ring-2 ring-surface-2"
              />
            )}
          </>
        ) : (
          <>
            {chosen(sections[0]).label}
            <ChevronDown className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden />
          </>
        )}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        className="sm:max-h-[calc(100dvh-16px)] sm:w-64"
      >
        {sections.map((s, i) => (
          <div key={s.title} className={cn('flex flex-col gap-1', i > 0 && 'mt-2')}>
            {several && (
              <p className="px-3 pb-1 pt-1 text-meta font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {s.title}
              </p>
            )}
            <div role="radiogroup" aria-label={s.title} className="flex flex-col gap-1">
              {s.options.map((o) => {
                const on = o.value === s.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pick(s, o.value)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body transition-colors duration-200 ease-soft',
                      on ? 'bg-primary/15 text-foreground' : 'text-foreground/90 hover:bg-white/5'
                    )}
                  >
                    <span className="flex-1">{o.label}</span>
                    {o.count != null &&
                      o.count > 0 &&
                      (s.counts === 'unread' ? (
                        <span
                          aria-label={`${o.count} unread`}
                          className="grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-meta font-semibold leading-none text-white"
                        >
                          {o.count}
                        </span>
                      ) : (
                        <span className="text-secondary tabular-nums text-muted-foreground">
                          {o.count.toLocaleString()}
                        </span>
                      ))}
                    <Check
                      className={cn('size-4 shrink-0 text-accent', !on && 'invisible')}
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {clearLabel && changed.length > 0 && (
          <>
            <span aria-hidden className="mx-3 my-1 h-px bg-line" />
            <button
              type="button"
              onClick={clear}
              className="flex min-h-11 w-full items-center rounded-button px-3 text-left text-button text-accent transition-colors duration-200 ease-soft hover:bg-white/5"
            >
              {clearLabel}
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}
