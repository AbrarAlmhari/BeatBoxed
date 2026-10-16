import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AuthContextValue = {
  session: Session | null
  user: User | null
  /** True until the initial session lookup settles — gate redirects on this. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  /**
   * Email and password only: the username and display name are picked in
   * setup (/welcome). The profile row starts with a username suggested from
   * the email address (handle_new_user), which setup's first step offers.
   */
  signUp: (args: { email: string; password: string }) => Promise<{ needsEmailConfirmation: boolean }>
  /** Sends the confirmation email again (sign-up's "Resend email", login). */
  resendConfirmation: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async signIn(email, password) {
        const { error } = await requireClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
      },

      async signUp({ email, password }) {
        const { data, error } = await requireClient().auth.signUp({
          email: email.trim(),
          password,
          // The link in the confirmation email signs them in on /welcome,
          // on whichever device they open it.
          options: { emailRedirectTo: confirmRedirect() },
        })
        if (error) throw error
        return { needsEmailConfirmation: !data.session }
      },

      async resendConfirmation(email) {
        const { error } = await requireClient().auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: confirmRedirect() },
        })
        if (error) throw error
      },

      async signOut() {
        const { error } = await requireClient().auth.signOut()
        if (error) throw error
      },
    }),
    [session, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/**
 * Where the confirmation link lands: setup. Supabase only follows it if the
 * URL is in the project's allowed redirect list (Authentication → URL
 * Configuration); otherwise it uses the Site URL, and the app still sends a
 * signed-in account that hasn't finished setup to /welcome.
 */
function confirmRedirect() {
  return `${window.location.origin}/welcome`
}
