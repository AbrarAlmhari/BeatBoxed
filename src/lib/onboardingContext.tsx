import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './auth'
import { getOnboardingState, type OnboardingState } from './onboarding'

type OnboardingApi = {
  /** null while loading, or when there's no profile row to read. */
  state: OnboardingState | null
  loading: boolean
  /** Re-reads the state (after setup finishes, a card is closed, ...). */
  refresh: () => Promise<void>
  /** Applies a change locally right away, before or without a re-read. */
  patch: (next: Partial<OnboardingState>) => void
  /** The tour on Home: whether it's showing, and how to start it. */
  tourOpen: boolean
  setTourOpen: (open: boolean) => void
}

const OnboardingContext = createContext<OnboardingApi | null>(null)

/** Wraps everything behind sign-in: /welcome and the app itself. */
export function OnboardingRoot() {
  // The id, not the user object: Supabase hands out a new object on every
  // token refresh, password change or re-check, and reloading on each one
  // put the whole app behind a spinner (stopping music, losing toasts).
  const userId = useAuth().user?.id
  const [state, setState] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [tourOpen, setTourOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      setState(await getOnboardingState(userId))
    } catch (err) {
      // Never lock someone out of the app over this: treat as set up.
      console.warn('[beatboxed] onboarding state failed:', err)
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  const patch = useCallback((next: Partial<OnboardingState>) => {
    setState((prev) => (prev ? { ...prev, ...next } : prev))
  }, [])

  const value = useMemo(
    () => ({ state, loading, refresh, patch, tourOpen, setTourOpen }),
    [state, loading, refresh, patch, tourOpen]
  )

  return (
    <OnboardingContext.Provider value={value}>
      <Outlet />
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding outside OnboardingRoot')
  return ctx
}

/**
 * The app proper: someone who hasn't finished setup goes to /welcome first.
 * Existing accounts were all marked as set up, so they never do.
 */
export function RequireSetup() {
  const { state, loading } = useOnboarding()
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={2} />
        <span className="sr-only">Loading</span>
      </div>
    )
  }
  if (state && !state.setupCompletedAt) return <Navigate to="/welcome" replace />
  return <Outlet />
}

export function useOptionalOnboarding(): OnboardingApi | null {
  return useContext(OnboardingContext)
}

