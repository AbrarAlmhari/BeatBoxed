import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Teammates cloning the repo start with an empty .env.local, so a missing key
// is a real state, not a bug. Warn instead of throwing so the UI still boots.
if (!isSupabaseConfigured) {
  console.warn(
    '[beatboxed] Supabase is not configured. Copy .env.example to .env.local ' +
      'and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null
