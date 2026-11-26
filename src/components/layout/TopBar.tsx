import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { BackButton } from '@/components/ui/BackButton'
import { NAV_ITEMS } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { useCreate } from '@/lib/create'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { BEATIE_OPENED } from '@/components/beatie/AskBeatiePill'
import { getNotificationCenter } from '@/lib/catalog'
import { cn } from '@/lib/cn'
import { logWarn } from '@/lib/log'

/**
 * Main tabs are reachable from the bottom nav and sidebar, so a back arrow
 * there would be confusing. Everything else gets one — driven off NAV_ITEMS,
 * so a new detail page picks it up with no extra wiring.
 *
 * Exact match matters: /profile is a tab, /profile/:userId is not.
 */
function shouldShowBack(pathname: string) {
  return !NAV_ITEMS.some((item) => item.to === pathname)
}

/**
 * A profile page (/profile or /profile/:userId, not its sub-lists) draws
 * its own top bar on phones — back and "⋯" over the header's glow — so this
 * one steps aside there below md.
 */
function isProfilePage(pathname: string) {
  return pathname === '/profile' || /^\/profile\/[^/]+\/?$/.test(pathname)
}

/** Main pages that show their name, large, in the phone's top bar (no logo). */
const PAGE_TITLES: Record<string, string> = {
  '/explore': 'Explore',
  '/library': 'Library',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
}

export function TopBar() {
  const create = useCreate()
  const { user } = useAuth()
  const location = useLocation()
  const [badge, setBadge] = useState(0)

  // Refetch on every navigation: acting on a request or reading a
  // notification happens on another route, and the badge has to follow.
  useEffect(() => {
    if (!user) return setBadge(0)
    let cancelled = false
    getNotificationCenter(user.id)
      .then((d) => {
        if (!cancelled) setBadge(d.badge)
      })
      .catch((err) => logWarn('layout', 'badge fetch failed', { error: err }))
    return () => {
      cancelled = true
    }
  }, [user, location.pathname])

  // Its height, for bars that stick just below it (Home's tab row).
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = header.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pageTitle = PAGE_TITLES[location.pathname]
  const home = location.pathname === '/'
  const showBack = shouldShowBack(location.pathname) && !pageTitle
  const profilePage = isProfilePage(location.pathname)

  return (
    <header
      ref={header}
      className={cn(
        'sticky top-0 z-20 -mx-4 mb-2 items-center',
        profilePage ? 'hidden md:flex' : 'flex',
        'glass-bar min-h-14 gap-2 border-b border-line px-4 py-2 sm:-mx-6 sm:px-6 md:border-b-0 md:bg-transparent md:backdrop-blur-none lg:-mx-8 lg:px-8'
      )}
    >
      {showBack ? (
        <BackButton className="-ml-2" />
      ) : pageTitle ? (
        // The page's own h1 is for screen readers on phones; this is its look.
        <p aria-hidden className="font-heading text-[26px] font-bold leading-tight tracking-[-0.01em] md:invisible">
          {pageTitle}
        </p>
      ) : (
        // The wordmark lives in the sidebar from `md` up, so only phones need it.
        <Logo variant="full" glow="v3" className="h-9 w-auto max-w-[150px] md:invisible" />
      )}

      <div className="flex-1" />

      {home && (
        <button
          type="button"
          aria-label="Ask Beatie"
          data-tour="ask-beatie"
          onClick={() => {
            window.dispatchEvent(new Event(BEATIE_OPENED))
            create.openBeatie()
          }}
          className="tap-44 round-btn border border-primary/40 bg-primary/20 transition-colors duration-200 ease-soft hover:bg-primary/30 active:scale-95 md:hidden"
        >
          <BeatieImage mood="mark" size={24} />
        </button>
      )}

      <NavLink
        to="/notifications"
        aria-label={badge > 0 ? `Notifications, ${badge} new` : 'Notifications'}
        className={({ isActive }) =>
          cn(
            'tap-44 round-btn relative bg-white/[0.06] transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95',
            // Stays active on /notifications/requests too, so the bell doesn't
            // go dim once you step into the requests list.
            isActive ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'
          )
        }
      >
        {({ isActive }) => (
          <>
            <Bell
              className={cn('size-5', isActive && 'text-primary')}
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            {badge > 0 && (
              <span
                aria-hidden
                className="absolute right-2 top-2 size-2.5 rounded-full bg-like ring-2 ring-background"
              />
            )}
          </>
        )}
      </NavLink>
    </header>
  )
}
