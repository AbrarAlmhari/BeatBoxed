import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { BeatieImage, type BeatieMood } from '@/components/beatie/BeatieImage'
import { cn } from '@/lib/cn'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useOnboarding } from '@/lib/onboardingContext'
import { markTour } from '@/lib/onboarding'

/**
 * The Beatie tour on Home (docs/mockups/onboarding, "Tour 1 6" to "Tour 6
 * 6"): the page dims, one real thing at a time is outlined, and Beatie's
 * bubble points at it.
 *
 * Each step finds its target by a data-tour attribute on the real element
 * (the first feed card, the composer, the Ask Beatie pill, and Explore,
 * Library and Profile in the navigation, which carry it in both the phone
 * bottom bar and the desktop sidebar). The visible copy wins, so the same
 * steps work on a phone and on desktop.
 *
 * The bubble goes below the target, or above when there isn't room (the
 * phone's bottom navigation), and is kept on screen, so it never covers
 * what it points at. Escape skips; Tab stays inside the bubble; the arrow
 * keys go back and forward. No movement with reduced motion.
 *
 * Finishing sets tutorial_completed_at, skipping tutorial_skipped_at, and
 * either one ends with "You're ready! Replay the tour anytime from
 * Settings." It never starts by itself; Settings has Replay tour.
 */

type TourStep = {
  target: string
  /** Where to point if the target isn't there (an empty feed). */
  fallback?: string
  title: string
  text: string
  mood: BeatieMood
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'feed-review',
    fallback: 'feed',
    title: 'This is your feed',
    text: 'Reviews from people you follow show up here. For You adds picks based on your tags.',
    mood: 'happy',
  },
  {
    target: 'composer',
    title: 'Rate a song',
    text: 'Tap here, find any song, give it stars, and add a few words if you want.',
    mood: 'default',
  },
  {
    target: 'ask-beatie',
    title: 'Ask me anything',
    text: 'Curious about a song? Ask me what the lyrics mean, get a translation, or learn about the artist.',
    mood: 'excited',
  },
  {
    target: 'nav-explore',
    title: 'Explore',
    text: "See what's trending, what's new, and songs picked for you.",
    mood: 'thinking',
  },
  {
    target: 'nav-library',
    title: 'Your library',
    text: 'Your playlists and the songs you liked live here. Make a new playlist anytime.',
    mood: 'default',
  },
  {
    target: 'nav-profile',
    title: 'Your profile',
    text: 'Your reviews, playlists, stats and the tags you picked. Edit them anytime.',
    mood: 'happy',
  },
]

const MARGIN = 16
const GAP = 14
const PAD = 6
/** Room for the phone's sticky top bar when scrolling a card up. */
const TOP_BAR = 80

function visibleTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el
  }
  return null
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function BeatieTour() {
  const { tourOpen, setTourOpen, patch } = useOnboarding()
  const { user } = useAuth()
  const toast = useToast()
  const { pathname } = useLocation()
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [bubbleHeight, setBubbleHeight] = useState(0)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  const open = tourOpen && pathname === '/'
  const step = TOUR_STEPS[index]

  useEffect(() => {
    if (tourOpen) setIndex(0)
  }, [tourOpen])

  // Find the step's element, bring it into view, then measure it; and keep
  // measuring as the page scrolls or resizes. The feed can still be loading
  // when the tour opens, so each measure looks for the target again and
  // moves from the fallback to the first card once it's there.
  useEffect(() => {
    if (!open) return
    let frame = 0
    let el: HTMLElement | null = null
    const resized = new ResizeObserver(() => measure())
    resized.observe(document.body)
    const find = () => {
      const found = visibleTarget(step.target) ?? (step.fallback ? visibleTarget(step.fallback) : null)
      if (found === el) return
      if (el) resized.unobserve(el)
      el = found
      if (!el) return
      resized.observe(el)
      const fixed = getComputedStyle(el).position === 'fixed' || el.closest('nav, aside') !== null
      if (!fixed) el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        find()
        setRect(el ? el.getBoundingClientRect() : null)
      })
    }
    measure()
    const settles = [reducedMotion() ? 0 : 450, 1000].map((ms) => setTimeout(measure, ms))
    document.addEventListener('scroll', measure, { passive: true, capture: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      settles.forEach(clearTimeout)
      resized.disconnect()
      document.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [open, step])

  useLayoutEffect(() => {
    if (bubbleRef.current) setBubbleHeight(bubbleRef.current.offsetHeight)
  }, [open, index, rect])

  // A tall card on a small phone leaves room neither below nor above it;
  // scroll it up (to just under the top bar) so the bubble fits beneath.
  useEffect(() => {
    if (!open || !rect || !bubbleHeight) return
    const vh = window.innerHeight
    const overflow = rect.bottom + PAD + GAP + bubbleHeight - (vh - MARGIN)
    const roomAbove = rect.top - PAD - GAP - bubbleHeight >= MARGIN
    if (overflow <= 1 || roomAbove || rect.top < TOP_BAR) return
    window.scrollBy({ top: Math.min(overflow, rect.top - TOP_BAR), behavior: 'auto' })
  }, [open, rect, bubbleHeight])

  useEffect(() => {
    if (open) nextRef.current?.focus({ preventScroll: true })
  }, [open, index])

  const end = useCallback(
    (outcome: 'completed' | 'skipped') => {
      setTourOpen(false)
      const now = new Date().toISOString()
      patch(outcome === 'completed' ? { tutorialCompletedAt: now } : { tutorialSkippedAt: now })
      if (user) void markTour(user.id, outcome).catch((err) => console.warn('[beatboxed] tour state not saved:', err))
      toast.show({ beatie: true, lead: "You're ready!", message: 'Replay the tour anytime from Settings.' })
    },
    [setTourOpen, patch, user, toast]
  )

  const next = useCallback(() => {
    if (index === TOUR_STEPS.length - 1) end('completed')
    else setIndex((i) => i + 1)
  }, [index, end])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Escape skips; arrows step; Tab stays in the bubble.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        end('skipped')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'Tab' && bubbleRef.current) {
        const items = [...bubbleRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        } else if (!bubbleRef.current.contains(document.activeElement)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, end, next, back])

  if (!open) return null

  // Where the bubble goes: below the target if it fits, otherwise above,
  // and inside the screen either way.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(vw - MARGIN * 2, 400)
  let top = vh / 2 - bubbleHeight / 2
  let left = (vw - width) / 2
  let placement: 'below' | 'above' | 'none' = 'none'
  let arrowX = width / 2
  if (rect) {
    const below = rect.bottom + PAD + GAP
    const above = rect.top - PAD - GAP - bubbleHeight
    if (below + bubbleHeight <= vh - MARGIN || above < MARGIN) {
      top = Math.min(below, vh - MARGIN - bubbleHeight)
      placement = 'below'
    } else {
      top = Math.max(MARGIN, above)
      placement = 'above'
    }
    const center = rect.left + rect.width / 2
    left = Math.min(Math.max(center - width / 2, MARGIN), vw - MARGIN - width)
    arrowX = Math.min(Math.max(center - left, 28), width - 28)
  }

  const titleId = 'beatie-tour-title'
  const textId = 'beatie-tour-text'
  const motion = 'transition-all duration-300 ease-soft motion-reduce:transition-none'
  // Small phones: the dots get their own row so Skip tour, Back and Next fit.
  const narrow = width < 360
  const dots = (
    <span className="flex items-center gap-1.5" aria-hidden>
      {TOUR_STEPS.map((_, i) => (
        <span
          key={i}
          className={cn('h-1.5 rounded-full', motion, i === index ? 'w-7 bg-primary' : 'w-1.5 bg-paper-line')}
        />
      ))}
    </span>
  )

  return createPortal(
    <div className="fixed inset-0 z-[70]" data-testid="beatie-tour">
      {/* The dim, with a lit outline around the target. Decoration; the
          page behind can't be clicked while the tour is open. */}
      {rect ? (
        <div
          aria-hidden
          className={cn('absolute rounded-card ring-[3px] ring-accent', motion)}
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px color-mix(in srgb, black 80%, transparent)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/80" />
      )}

      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        className={cn('absolute rounded-[24px] bg-paper p-5 text-paper-foreground shadow-raised', motion)}
        style={{ top, left, width }}
      >
        {placement !== 'none' && (
          <span
            aria-hidden
            className={cn(
              'absolute size-4 rotate-45 bg-paper',
              placement === 'below' ? '-top-2' : '-bottom-2'
            )}
            style={{ left: arrowX - 8 }}
          />
        )}
        <div className="flex gap-3.5">
          <BeatieImage mood={step.mood} size={56} className="shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-meta font-bold uppercase tracking-wide text-primary">
              Step {index + 1} of {TOUR_STEPS.length}
            </p>
            <h2 id={titleId} className="text-[20px] font-bold leading-tight">
              {step.title}
            </h2>
            <p id={textId} className="text-body text-paper-muted">
              {step.text}
            </p>
          </div>
        </div>
        {narrow && <div className="mt-4 flex justify-center">{dots}</div>}
        <div className={cn('flex items-center gap-2', narrow ? 'mt-3' : 'mt-4')}>
          <button
            type="button"
            onClick={() => end('skipped')}
            className="-ml-2 min-h-11 whitespace-nowrap rounded-button px-2 text-button text-paper-muted transition-colors duration-200 ease-soft hover:text-paper-foreground"
          >
            Skip tour
          </button>
          <span className="flex flex-1 justify-center">{!narrow && dots}</span>
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              className="min-h-11 rounded-chip border border-paper-line px-4 text-button text-paper-foreground transition-colors duration-200 ease-soft hover:bg-paper-line/40"
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={next}
            className="min-h-11 rounded-chip bg-primary px-5 text-button text-white transition-colors duration-200 ease-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {index === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
