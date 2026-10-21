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
import { authRedirect } from './authLinks'

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
  /**
   * Emails a password reset link to /reset-password. Succeeds whether or not
   * the address has an account, so the app never says which.
   */
  sendPasswordReset: (email: string) => Promise<void>
  /** Sets a new password for whoever is signed in (the reset link signs them in). */
  updatePassword: (password: string) => Promise<void>
  /**
   * Settings' "Change password": checks the current password by signing in
   * with it, then sets the new one. Throws WRONG_CURRENT_PASSWORD if it's wrong.
   */
  changePassword: (current: string, next: string) => Promise<void>
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
          options: { emailRedirectTo: authRedirect('/welcome') },
        })
        if (error) throw error
        return { needsEmailConfirmation: !data.session }
      },

      async resendConfirmation(email) {
        const { error } = await requireClient().auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: authRedirect('/welcome') },
        })
        if (error) throw error
      },

      async sendPasswordReset(email) {
        const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirect('/reset-password'),
        })
        // Asking again within Supabase's minute for the same address: one
        // was just sent, so that's a success too. Saying otherwise would
        // reveal that the address has an account.
        if (error && !isTooSoonForThisAddress(error)) throw error
      },

      async updatePassword(password) {
        const { error } = await requireClient().auth.updateUser({ password })
        if (error) throw error
      },

      async changePassword(current, next) {
        const client = requireClient()
        const email = session?.user.email
        if (!email) throw new Error('Not signed in')
        const { error: checkError } = await client.auth.signInWithPassword({ email, password: current })
        if (checkError) {
          const m = checkError.message.toLowerCase()
          if (m.includes('invalid login credentials')) throw new Error(WRONG_CURRENT_PASSWORD)
          throw checkError
        }
        const { error } = await client.auth.updateUser({ password: next })
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

/** changePassword's error when the current password is wrong. */
export const WRONG_CURRENT_PASSWORD = "That's not your current password."

/**
 * Supabase's "For security purposes, you can only request this after N
 * seconds": a per-address limit, unlike the project-wide email rate limit.
 */
function isTooSoonForThisAddress(error: { message?: string }) {
  return /for security purposes/i.test(error.message ?? '')
}
