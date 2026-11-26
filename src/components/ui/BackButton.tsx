import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Rendered by TopBar, not by pages — see shouldShowBack() there for which
 * routes get one.
 */
export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()

  function goBack() {
    // React Router labels the first entry of a visit 'default'. Seeing it
    // means there's nothing of ours to go back to — a shared link opened
    // cold, or a refresh — and navigate(-1) would leave the site entirely.
    if (location.key === 'default') navigate('/', { replace: true })
    else navigate(-1)
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className={cn(
        'tap-44 grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-foreground transition-all duration-200 ease-soft hover:bg-white/10 hover:text-foreground active:scale-95',
        className
      )}
    >
      <ArrowLeft className="size-5" strokeWidth={2} />
    </button>
  )
}
