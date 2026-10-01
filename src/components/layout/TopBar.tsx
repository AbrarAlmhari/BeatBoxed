import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { NotificationPanel } from '@/components/notifications/NotificationPanel'
import { useAuth } from '@/lib/auth'
import { getNotificationCenter } from '@/lib/catalog'

export function TopBar() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [badge, setBadge] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Badge on app load; the panel refreshes it again each time it opens.
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
  }, [user])

  // Desktop dropdown should close on an outside click or Escape; the mobile
  // sheet has its own backdrop.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex items-center justify-between gap-3 border-b border-white/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:border-b-0 md:bg-transparent md:backdrop-blur-none lg:-mx-8 lg:px-8">
      {/* The wordmark lives in the sidebar from `md` up, so only phones need it here. */}
      <Logo
        variant="full"
        glow="md"
        className="h-9 w-auto max-w-[150px] md:invisible"
      />

      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={badge > 0 ? `Notifications, ${badge} new` : 'Notifications'}
          aria-expanded={open}
          className="relative grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <Bell className="size-5" strokeWidth={1.75} />
          {badge > 0 && (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>

        {open && user && (
          <>
            {/* Phone: full-height sheet. */}
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div className="animate-fade-in fixed inset-x-0 bottom-0 top-0 z-50 flex flex-col bg-background md:hidden">
              <NotificationPanel
                viewerId={user.id}
                onClose={() => setOpen(false)}
                onDataChange={(d) => setBadge(d.badge)}
              />
            </div>

            {/* Desktop: dropdown anchored to the bell. */}
            <div className="animate-fade-in absolute right-0 top-12 z-50 hidden max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-card border border-white/5 bg-background shadow-card md:flex">
              <NotificationPanel
                viewerId={user.id}
                onClose={() => setOpen(false)}
                onDataChange={(d) => setBadge(d.badge)}
              />
            </div>
          </>
        )}
      </div>
    </header>
  )
}
