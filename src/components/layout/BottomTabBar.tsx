import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/nav'
import { cn } from '@/lib/cn'

/** Phone only. Hidden from `md` up, where Sidebar takes over. */
export function BottomTabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-background/85 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Primary"
    >
      <ul className="flex items-stretch">
        {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 transition-colors duration-200 ease-soft',
                  'active:scale-[0.94] motion-safe:transition-transform',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid place-items-center rounded-full px-4 py-1 transition-colors duration-200',
                      isActive ? 'bg-primary/15' : 'bg-transparent'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-[21px] transition-colors duration-200',
                        isActive && 'text-primary'
                      )}
                      strokeWidth={isActive ? 2.25 : 1.75}
                    />
                  </span>
                  <span className="text-meta">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
