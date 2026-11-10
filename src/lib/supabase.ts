import { createClient, type SupabaseClient } from '@supabase/supabase-js'
// First, so it reads an email link's details before the client tidies the
// address bar.
import './authLinks'
import { logWarn } from './log'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Teammates cloning the repo start with an empty .env.local, so a missing key
// is a real state, not a bug. Warn instead of throwing so the UI still boots.
if (!isSupabaseConfigured) {
  logWarn(
    'supabase',
    'not configured: copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
  )
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null
