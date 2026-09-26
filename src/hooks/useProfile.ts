import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

type ProfileSummary = { display_name: string | null; username: string | null }

/**
 * Reads the signed-in user's profiles row. Returns null while loading, and also
 * when no row exists — the handle_new_user() trigger may not have been applied
 * to the project yet, so callers should fall back rather than assume a row.
 */
export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase || !user) {
      setLoading(false)
      return
    }

    let cancelled = false

    supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.warn('[beatboxed] profile lookup failed:', error.message)
        setProfile(data ?? null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  /** Best available name: profile, then email local-part, then a neutral word. */
  const displayName =
    profile?.display_name ||
    profile?.username ||
    user?.email?.split('@')[0] ||
    'listener'

  return { profile, displayName, loading }
}
