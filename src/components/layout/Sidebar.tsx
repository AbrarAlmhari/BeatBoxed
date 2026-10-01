import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/nav'
import { cn } from '@/lib/cn'
import { Logo } from '@/components/ui/Logo'

/**
 * Tablet and up. Hidden below `md`, where BottomTabBar takes over.
 * `md` renders an icon rail; `lg` expands to icon + label.
 */
export function Sidebar() {
  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-white/5 bg-surface/60 px-3 py-6 backdrop-blur-xl md:flex lg:w-60 lg:px-4"
      aria-label="Primary"
    >
      <div className="mb-8 flex items-center justify-center px-2 lg:justify-start">
        <Logo variant="icon" glow="sm" className="size-9 shrink-0 lg:hidden" />
        <Logo
          variant="full"
          glow="md"
          className="hidden h-11 w-auto max-w-full lg:block"
        />
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            title={label}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center rounded-button transition-colors duration-200 ease-soft',
                'justify-center px-0 py-3 lg:justify-start lg:gap-3 lg:px-3',
                'hover:bg-white/5 active:scale-[0.98] motion-safe:transition-transform',
                isActive
                  ? 'bg-primary/12 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 h-5 w-[3px] rounded-r-full bg-primary transition-opacity duration-200',
                    isActive ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <Icon
                  className={cn(
                    'size-[22px] shrink-0 transition-colors duration-200',
                    isActive && 'text-primary'
                  )}
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span className="hidden text-button lg:block">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
