import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { useAuth } from '@/lib/auth'
import { useOnboarding } from '@/lib/onboardingContext'
import { dismissWelcomeCard } from '@/lib/onboarding'

/**
 * "Your music tags are back": once, at the top of Home, for accounts that
 * existed before onboarding (they never see /welcome). Pick my tags opens
 * Edit profile at the tags; Take the tour starts the tour. Any of the
 * three, close included, hides it for good.
 */
export function WelcomeCard() {
  const { user } = useAuth()
  const { state, patch, setTourOpen } = useOnboarding()
  const navigate = useNavigate()

  if (!user || !state || !state.setupCompletedAt || state.welcomeCardDismissedAt) return null

  function dismiss() {
    if (!user) return
    patch({ welcomeCardDismissedAt: new Date().toISOString() })
    void dismissWelcomeCard(user.id).catch((err) => console.warn('[beatboxed] welcome card not saved:', err))
  }

  return (
    <section
      aria-labelledby="welcome-card-title"
      className="relative flex flex-col gap-4 rounded-card border border-primary/50 bg-gradient-to-br from-primary/20 to-primary/5 p-5"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
      >
        <X className="size-5" strokeWidth={1.75} />
      </button>
      <div className="flex items-start gap-4 pr-8">
        <BeatieImage mood="happy" size={72} className="shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 id="welcome-card-title" className="text-section-title">
            Your music tags are back
          </h2>
          <p className="text-body text-muted-foreground">
            Pick the genres you want on your profile, or let me show you what's new.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            dismiss()
            navigate(`/profile/${user.id}?edit=tags`)
          }}
          className="min-h-12 rounded-chip bg-primary px-4 text-button text-white transition-colors duration-200 ease-soft hover:bg-accent"
        >
          Pick my tags
        </button>
        <button
          type="button"
          onClick={() => {
            dismiss()
            setTourOpen(true)
          }}
          className="min-h-12 rounded-chip border border-line-strong px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5"
        >
          Take the tour
        </button>
      </div>
    </section>
  )
}
