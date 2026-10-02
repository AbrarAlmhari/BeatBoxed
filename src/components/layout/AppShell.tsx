import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { BottomTabBar } from './BottomTabBar'
import { TopBar } from './TopBar'
import { cn } from '@/lib/cn'
import { MiniPlayer } from '@/components/player/MiniPlayer'
import { PlayerProvider, usePlayer } from '@/lib/player'
import { FollowsProvider } from '@/lib/follows'
import { ToastProvider } from '@/lib/toast'

/**
 * The provider wraps the shell rather than a page, so audio survives
 * navigation between tabs.
 */
export function AppShell() {
  return (
    <FollowsProvider>
      <PlayerProvider>
        <ToastProvider>
          <ShellBody />
        </ToastProvider>
      </PlayerProvider>
    </FollowsProvider>
  )
}

function ShellBody() {
  const { pathname } = useLocation()
  const { current } = usePlayer()

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
        <main
          className={cn(
            'mx-auto w-full max-w-[1400px] px-4 pt-0 sm:px-6 lg:px-8',
            // Clear the bottom nav, and the mini player when it's showing.
            current ? 'pb-44 md:pb-28' : 'pb-28 md:pb-12'
          )}
        >
          <TopBar />
          {/* Re-keying on pathname restarts the entrance animation per tab. */}
          <div key={pathname} className="animate-page-in pt-2">
            <Outlet />
          </div>
        </main>
      </div>

      <MiniPlayer />
      <BottomTabBar />
    </div>
  )
}
