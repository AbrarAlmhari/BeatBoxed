import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

export type ProfileTab = 'reviews' | 'playlists' | 'stats' | 'likes'

export const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'stats', label: 'Stats' },
  { id: 'likes', label: 'Likes' },
]

export const tabId = (t: ProfileTab) => `profile-tab-${t}`
export const panelId = (t: ProfileTab) => `profile-panel-${t}`

/**
 * Reviews · Playlists · Stats · Likes, underlined. Shares the width on
 * phones, sits left on desktop, and sticks under the top bar once scrolled
 * past (top-0 on phones, where the app's top bar is hidden on the profile).
 *
 * A real tablist: arrow keys move between tabs, Home and End jump.
 */
export function ProfileTabBar({
  tab,
  onChange,
}: {
  tab: ProfileTab
  onChange: (next: ProfileTab) => void
}) {
  const refs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({})

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = PROFILE_TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % PROFILE_TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + PROFILE_TABS.length) % PROFILE_TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = PROFILE_TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    const id = PROFILE_TABS[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-white/10 bg-background/90 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 md:top-16 lg:-mx-8 lg:px-8">
      <div role="tablist" aria-label="Profile" onKeyDown={onKey} className="flex md:gap-2">
        {PROFILE_TABS.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={active}
              aria-controls={panelId(t.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                '-mb-px min-h-12 flex-1 border-b-2 text-button transition-colors duration-200 ease-soft md:flex-none md:px-5',
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
