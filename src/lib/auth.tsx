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
  signUp: (args: {
    email: string
    password: string
    username: string
    displayName: string
  }) => Promise<{ needsEmailConfirmation: boolean }>
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

      async signUp({ email, password, username, displayName }) {
        const { data, error } = await requireClient().auth.signUp({
          email: email.trim(),
          password,
          // Read by the handle_new_user() trigger to seed the profiles row.
          options: {
            data: { username: username.trim(), display_name: displayName.trim() },
          },
        })
        if (error) throw error
        return { needsEmailConfirmation: !data.session }
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
