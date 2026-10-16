import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

/**
 * The username rule, the same as the database's (migration 0037): 4–20
 * characters of lowercase letters, numbers, _ and ., unique regardless of
 * case. It applies to new and changed usernames only; older, shorter ones
 * are kept as they are. Capitals belong in the display name.
 */
export const USERNAME_MIN = 4
export const USERNAME_MAX = 20
export const USERNAME_RULE = `${USERNAME_MIN}–${USERNAME_MAX} characters: letters, numbers, _ and .`

/** What people type, as it will be stored. */
export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase()
}

export type UsernameProblem = 'short' | 'long' | 'chars'

/** The first thing wrong with a (normalised) username, or null. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (!/^[a-z0-9_.]*$/.test(name)) return 'chars'
  if (name.length < USERNAME_MIN) return 'short'
  if (name.length > USERNAME_MAX) return 'long'
  return null
}

export const USERNAME_MESSAGES: Record<UsernameProblem | 'taken', string> = {
  short: `At least ${USERNAME_MIN} characters`,
  long: `At most ${USERNAME_MAX} characters`,
  chars: 'Only letters, numbers, _ and .',
  taken: 'Taken',
}

/** Exact, case-insensitive (the old ILIKE check treated _ as a wildcard). */
export async function isUsernameAvailable(username: string) {
  if (!supabase) throw new Error('Supabase is not configured')
  const name = normalizeUsername(username)
  if (!name) return false
  const { data, error } = await supabase.rpc('username_available', { p_username: name })
  if (error) throw error
  return data === true
}

export type UsernameStatus =
  | { state: 'idle' }
  | { state: 'unchanged' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'invalid'; problem: UsernameProblem }
  | { state: 'taken' }

/**
 * Live status for a username field. `current` is the user's existing
 * username (Edit profile): keeping it is always fine, even if it's older
 * and shorter than the rule.
 */
export function useUsernameStatus(value: string, current?: string | null): UsernameStatus {
  const name = normalizeUsername(value)
  const debounced = useDebouncedValue(name, 350)
  const [remote, setRemote] = useState<{ name: string; ok: boolean | null } | null>(null)

  const unchanged = Boolean(current) && name === normalizeUsername(current ?? '')
  const problem = name ? usernameProblem(name) : null

  useEffect(() => {
    if (!debounced || unchanged || usernameProblem(debounced)) return
    let cancelled = false
    isUsernameAvailable(debounced)
      .then((ok) => !cancelled && setRemote({ name: debounced, ok }))
      .catch((err) => {
        console.warn('[beatboxed] username check failed:', err)
        // Don't block on a failed check; the database still guards it.
        if (!cancelled) setRemote({ name: debounced, ok: null })
      })
    return () => {
      cancelled = true
    }
  }, [debounced, unchanged])

  if (!name) return { state: 'idle' }
  if (unchanged) return { state: 'unchanged' }
  if (problem) return { state: 'invalid', problem }
  if (!remote || remote.name !== name) return { state: 'checking' }
  if (remote.ok === null) return { state: 'idle' }
  return remote.ok ? { state: 'available' } : { state: 'taken' }
}

/**
 * Whether a username may be submitted, given its live status. A check still
 * running (or one that failed) doesn't block: the database has the last word.
 */
export function usernameSubmittable(status: UsernameStatus) {
  return status.state !== 'invalid' && status.state !== 'taken'
}
