import { useCallback, useEffect, useState } from 'react'
import { BeatieImage } from './BeatieImage'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/cn'

/** How long the hello bubble stays if nobody taps it. */
const HELLO_MS = 6000
/** How long it takes to fold away (none with reduced motion). */
const LEAVE_MS = 250

const helloKey = (userId: string) => `beatboxed:beatie-hello-seen:${userId}`

/**
 * Remembered per user in this browser. Storage can be unavailable (private
 * windows, blocked site data), in which case the bubble simply shows.
 */
function helloSeen(userId: string) {
  try {
    return localStorage.getItem(helloKey(userId)) === '1'
  } catch {
    return false
  }
}
function rememberHello(userId: string) {
  try {
    localStorage.setItem(helloKey(userId), '1')
  } catch {
    // Not remembered; it may show once more. Harmless.
  }
}

export type BeatieHelloState = { state: 'hidden' | 'shown' | 'leaving'; dismiss: () => void }

/**
 * The first time someone sees the pill, a small bubble from Beatie points at
 * it. It goes away when tapped, when the pill is tapped, or after a few
 * seconds, and doesn't come back for that user.
 */
export function useBeatieHello(): BeatieHelloState {
  const { user } = useAuth()
  const [state, setState] = useState<BeatieHelloState['state']>('hidden')

  const dismiss = useCallback(() => {
    if (user) rememberHello(user.id)
    setState((s) => (s === 'shown' ? 'leaving' : s))
  }, [user])

  useEffect(() => {
    if (!user || helloSeen(user.id)) return
    setState('shown')
    const t = setTimeout(dismiss, HELLO_MS)
    return () => clearTimeout(t)
  }, [user, dismiss])

  // Folds away, then leaves the page.
  useEffect(() => {
    if (state !== 'leaving') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => setState('hidden'), reduced ? 0 : LEAVE_MS)
    return () => clearTimeout(t)
  }, [state])

  return { state, dismiss }
}

/**
 * The "Ask Beatie" pill at the end of Home's tab row. Styled with the accent
 * tokens like the active tab, but with Beatie's face and outside the
 * tablist, so it reads as a button rather than a third tab.
 *
 * The tap target is at least 44px tall and wide even though the pill
 * itself is smaller. Under 370px wide only Beatie shows; "Ask Beatie"
 * stays for screen readers.
 */
export function AskBeatiePill({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-label="Ask Beatie"
        data-tour="ask-beatie"
        onClick={onOpen}
        className="group flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none"
      >
        <span className="flex items-center gap-2 rounded-chip border border-primary/70 bg-primary/15 py-1 pl-1 pr-3.5 text-button text-foreground shadow-card transition-all duration-200 ease-soft group-hover:bg-primary/25 group-active:scale-[0.97] group-focus-visible:ring-2 group-focus-visible:ring-primary group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background max-[369px]:pr-1">
          <span className="grid size-[26px] place-items-center rounded-full bg-background/70">
            <BeatieImage mood="mark" size={20} />
          </span>
          <span className="max-[369px]:sr-only">Ask Beatie</span>
        </span>
      </button>
    </div>
  )
}

/**
 * The hello bubble, under the pill's row. It takes its own space in the
 * page rather than floating over what's below (the composer), and folds
 * away when it goes.
 */
export function BeatieHello({ hello }: { hello: BeatieHelloState }) {
  if (hello.state === 'hidden') return null
  const leaving = hello.state === 'leaving'
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-250 ease-soft motion-reduce:transition-none',
        leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]'
      )}
    >
      <div className="flex justify-end overflow-hidden pt-3">
        <button
          type="button"
          onClick={hello.dismiss}
          aria-label="Hi, I'm Beatie! Ask me about any song. Tap to dismiss."
          className="animate-fade-in relative flex w-64 items-center gap-3 rounded-card border border-primary/40 bg-surface-2 p-3 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:animate-none"
        >
          {/* Points up at the pill. */}
          <span
            aria-hidden
            className="absolute -top-1.5 right-6 size-3 rotate-45 border-l border-t border-primary/40 bg-surface-2"
          />
          <BeatieImage mood="excited" size={48} />
          <span className="text-secondary text-foreground">Hi, I'm Beatie! Ask me about any song.</span>
        </button>
      </div>
    </div>
  )
}
