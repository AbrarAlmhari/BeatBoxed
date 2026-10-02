import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { BackButton } from '@/components/ui/BackButton'
import { NAV_ITEMS } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { getNotificationCenter } from '@/lib/catalog'
import { cn } from '@/lib/cn'

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

export function TopBar() {
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
      .catch((err) => console.warn('[beatboxed] badge fetch failed:', err))
    return () => {
      cancelled = true
    }
  }, [user, location.pathname])

  const showBack = shouldShowBack(location.pathname)

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex items-center gap-3 border-b border-white/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:border-b-0 md:bg-transparent md:backdrop-blur-none lg:-mx-8 lg:px-8">
      {showBack ? (
        <BackButton className="-ml-2" />
      ) : (
        // The wordmark lives in the sidebar from `md` up, so only phones need it.
        <Logo
          variant="full"
          glow="md"
          className="h-9 w-auto max-w-[150px] md:invisible"
        />
      )}

      <div className="flex-1" />

      <NavLink
        to="/notifications"
        aria-label={badge > 0 ? `Notifications, ${badge} new` : 'Notifications'}
        className={({ isActive }) =>
          cn(
            'relative grid size-10 shrink-0 place-items-center rounded-full transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95',
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
              <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </>
        )}
      </NavLink>
    </header>
  )
}
