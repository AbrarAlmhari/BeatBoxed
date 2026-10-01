import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Shown on every page that isn't a main tab. The four tabs are reachable from
 * the bottom nav and sidebar, so a back arrow there would be noise.
 *
 * Opened from a shared link there's no in-app history to pop, and
 * navigate(-1) would walk the user out of the site — so that case goes Home.
 */
export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()

  function goBack() {
    // react-router sets idx on entries it created; 0 means we arrived here
    // directly rather than from somewhere inside the app.
    const idx = (location.state as { idx?: number } | null)?.idx
    const hasHistory = typeof idx === 'number' ? idx > 0 : window.history.length > 1

    if (hasHistory) navigate(-1)
    else navigate('/', { replace: true })
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95',
        className
      )}
    >
      <ArrowLeft className="size-5" strokeWidth={2} />
    </button>
  )
}
