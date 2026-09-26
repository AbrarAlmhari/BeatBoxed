import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { BottomTabBar } from './BottomTabBar'
import { TopBar } from './TopBar'

export function AppShell() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="min-h-dvh bg-background">
      {/* Single soft wash behind everything — atmospheric, not a neon glow. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(70%_100%_at_50%_0%,rgba(139,92,246,0.10),transparent_70%)]"
      />

      <Sidebar />

      <div className="relative md:pl-20 lg:pl-60">
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-0 sm:px-6 md:pb-12 lg:px-8">
          <TopBar />
          {/* Re-keying on pathname restarts the entrance animation per tab. */}
          <div key={pathname} className="animate-page-in pt-2">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomTabBar />
    </div>
  )
}
