import { Bell } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex items-center justify-between gap-3 border-b border-white/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:border-b-0 md:bg-transparent md:backdrop-blur-none lg:-mx-8 lg:px-8">
      {/* The wordmark lives in the sidebar from `md` up, so only phones need it here. */}
      <Logo
        variant="full"
        glow="md"
        className="h-9 w-auto max-w-[150px] md:invisible"
      />

      <button
        type="button"
        aria-label="Notifications"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
      >
        <Bell className="size-5" strokeWidth={1.75} />
      </button>
    </header>
  )
}
