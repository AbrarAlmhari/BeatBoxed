import type { ReactNode } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { BeatieImage, type BeatieMood } from '@/components/beatie/BeatieImage'
import { cn } from '@/lib/cn'
import { SETUP_STEPS } from '@/lib/onboarding'

/**
 * The frame every setup step shares (docs/mockups/onboarding): the step
 * count, Back, "Required" or Skip, the 7-part progress bar, then the step,
 * then the main button pinned at the bottom. A centred column on desktop.
 */
export function SetupFrame({
  step,
  onBack,
  onSkip,
  required = false,
  title,
  subtitle,
  beatie,
  children,
  footerNote,
  primary,
  secondary,
}: {
  step: number
  onBack?: () => void
  onSkip?: () => void
  /** Shows "Required" where Skip would be (step 1). */
  required?: boolean
  title: string
  subtitle?: ReactNode
  /** Beatie's speech bubble above the title, when the step has one. */
  beatie?: { mood: BeatieMood; text: string }
  children: ReactNode
  /** A line over the main button, e.g. "4 selected". */
  footerNote?: ReactNode
  primary: { label: string; onClick: () => void; disabled?: boolean; pending?: boolean }
  secondary?: { label: string; onClick: () => void }
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-6">
      <header className="flex flex-col gap-3">
        <div className="relative flex min-h-11 items-center justify-between">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="-ml-3 grid size-11 place-items-center rounded-full text-foreground transition-colors duration-200 ease-soft hover:bg-white/5"
            >
              <ChevronLeft className="size-6" strokeWidth={2} />
            </button>
          ) : (
            <span className="text-button text-muted-foreground">
              Step {step} of {SETUP_STEPS}
            </span>
          )}
          {onBack && (
            <span className="absolute left-1/2 -translate-x-1/2 text-button text-muted-foreground">
              Step {step} of {SETUP_STEPS}
            </span>
          )}
          {onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="-mr-2 inline-flex min-h-11 items-center rounded-button px-2 text-button text-accent transition-colors duration-200 ease-soft hover:text-foreground"
            >
              Skip
            </button>
          ) : required ? (
            <span className="text-secondary text-muted-foreground">Required</span>
          ) : (
            <span />
          )}
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={SETUP_STEPS}
          aria-valuenow={step}
          aria-valuetext={`Step ${step} of ${SETUP_STEPS}`}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${SETUP_STEPS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: SETUP_STEPS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 rounded-full transition-colors duration-300 ease-soft motion-reduce:transition-none',
                i < step ? 'bg-primary' : 'bg-white/10'
              )}
            />
          ))}
        </div>
      </header>

      <main className="animate-page-in flex flex-1 flex-col gap-5 pt-7 motion-reduce:animate-none">
        {beatie && (
          <div className="flex items-start gap-3">
            <BeatieImage mood={beatie.mood} size={56} className="shrink-0" />
            <p className="flex-1 rounded-card border border-primary/40 bg-surface px-4 py-3 text-body text-foreground">
              {beatie.text}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-page-title">{title}</h1>
          {subtitle && <p className="text-body text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </main>

      <footer className="sticky bottom-0 -mx-4 mt-6 flex flex-col items-center gap-3 bg-gradient-to-t from-background via-background to-background/0 px-4 pt-6 sm:-mx-6 sm:px-6">
        {footerNote && <p className="text-button text-accent">{footerNote}</p>}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled || primary.pending}
          className="flex min-h-13 w-full items-center justify-center gap-2 rounded-chip bg-primary px-6 text-[17px] font-semibold text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-primary"
        >
          {primary.pending && <Loader2 className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2.5} aria-hidden />}
          {primary.label}
        </button>
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="min-h-11 rounded-button px-4 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            {secondary.label}
          </button>
        )}
      </footer>
    </div>
  )
}
