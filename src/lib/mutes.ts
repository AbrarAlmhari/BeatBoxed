import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Muting (0046). Only the person who mutes is affected, and only they can
 * read their mutes: the muted person can't find out from the app or the
 * API.
 *
 * The database already leaves muted people out of the feeds, suggestions,
 * notifications and comment previews. The app uses the set below for the
 * lists it reads directly: the song page's reviews, folded comments, and
 * notifications that arrived before the mute.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export type MutedAccount = {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  mutedAt: string
}

/* ---------------------------------------------------- the shared set */

let mutedIds: Set<string> | null = null
let loadedFor: string | null = null
let loading: Promise<Set<string>> | null = null
const listeners = new Set<(ids: Set<string>) => void>()

function publish(next: Set<string>) {
  mutedIds = next
  for (const l of listeners) l(next)
}

async function loadMutedIds(userId: string): Promise<Set<string>> {
  if (mutedIds && loadedFor === userId) return mutedIds
  if (loading && loadedFor === userId) return loading
  loadedFor = userId
  loading = (async () => {
    const { data, error } = await requireClient().from('user_mutes').select('muted_id').eq('muter_id', userId)
    if (error) throw error
    const ids = new Set(((data ?? []) as { muted_id: string }[]).map((r) => r.muted_id))
    publish(ids)
    return ids
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

/** Everyone you've muted, kept in step as you mute and unmute. */
export function useMutedIds(userId: string | undefined): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => (loadedFor === userId && mutedIds) || new Set())
  useEffect(() => {
    if (!userId) return
    listeners.add(setIds)
    loadMutedIds(userId)
      .then(setIds)
      .catch((err) => console.warn('[beatboxed] mutes lookup failed:', err))
    return () => {
      listeners.delete(setIds)
    }
  }, [userId])
  return ids
}

/** For loaders outside React (the notifications page's first load). */
export function getMutedIds(userId: string) {
  return loadMutedIds(userId)
}

/* ------------------------------------------------------- read and write */

export async function mute(userId: string, targetId: string) {
  const { error } = await requireClient().from('user_mutes').insert({ muter_id: userId, muted_id: targetId })
  // Already muted is success.
  if (error && error.code !== '23505') throw error
  publish(new Set(mutedIds ?? []).add(targetId))
}

export async function unmute(userId: string, targetId: string) {
  const { error } = await requireClient()
    .from('user_mutes')
    .delete()
    .eq('muter_id', userId)
    .eq('muted_id', targetId)
  if (error) throw error
  const next = new Set(mutedIds ?? [])
  next.delete(targetId)
  publish(next)
}

/** Settings → Muted accounts, newest first. */
export async function getMutedAccounts(userId: string): Promise<MutedAccount[]> {
  const { data, error } = await requireClient()
    .from('user_mutes')
    .select('muted_id, created_at, profiles!user_mutes_muted_id_fkey(username, display_name, avatar_url)')
    .eq('muter_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  type Row = {
    muted_id: string
    created_at: string
    profiles:
      | { username: string | null; display_name: string | null; avatar_url: string | null }
      | { username: string | null; display_name: string | null; avatar_url: string | null }[]
      | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return {
      id: r.muted_id,
      username: p?.username ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      mutedAt: r.created_at,
    }
  })
}

/** "just now", "5 minutes ago", "2 weeks ago". */
export function mutedAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const steps: [number, number, string][] = [
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [604800, 86400, 'day'],
    [2629800, 604800, 'week'],
    [31557600, 2629800, 'month'],
  ]
  for (const [limit, per, word] of steps) {
    if (s < limit) {
      const n = Math.floor(s / per)
      return `${n} ${word}${n === 1 ? '' : 's'} ago`
    }
  }
  const y = Math.floor(s / 31557600)
  return `${y} year${y === 1 ? '' : 's'} ago`
}
