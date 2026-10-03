import { supabase } from './supabase'

/**
 * Everything the Settings page reads and writes.
 *
 * Several of these depend on 0021 and 0022. Until those are applied the
 * reads fall back to today's behaviour — all notifications on, every account
 * public — rather than throwing, so a checkout that is ahead of the database
 * still runs. Each fallback is marked and can be deleted once the migrations
 * are in.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/** Missing table / missing column, i.e. the migration hasn't been applied. */
const NOT_MIGRATED = new Set(['PGRST205', 'PGRST204', '42703', '42P01', 'PGRST202'])
const isNotMigrated = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  NOT_MIGRATED.has((err as { code?: string }).code ?? '')

/* ------------------------------------------------------------- language */

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/* -------------------------------------------------- notification switches */

export type NotificationPrefs = {
  review_liked: boolean
  review_commented: boolean
  thread_reply: boolean
  friend_accepted: boolean
  artist_release: boolean
  friend_requests: boolean
  announcements: boolean
}

export type NotificationPrefKey = keyof NotificationPrefs

/** No row means everything is on, which is what a new account gets. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  review_liked: true,
  review_commented: true,
  thread_reply: true,
  friend_accepted: true,
  artist_release: true,
  friend_requests: true,
  announcements: true,
}

export async function getNotificationPrefs(
  userId: string
): Promise<NotificationPrefs> {
  const { data, error } = await requireClient()
    .from('notification_preferences')
    // `*` rather than a column list so this survives 0026 adding
    // artist_release, and keeps working before it is applied.
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isNotMigrated(error)) return DEFAULT_NOTIFICATION_PREFS // pre-0021
    throw error
  }
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(data ?? {}) }
}

/**
 * Upsert, because the row is created lazily: a user who never opens Settings
 * has no row at all and gets the defaults from notify().
 */
export async function setNotificationPref(
  userId: string,
  key: NotificationPrefKey,
  value: boolean
) {
  const { error } = await requireClient()
    .from('notification_preferences')
    .upsert({ user_id: userId, [key]: value }, { onConflict: 'user_id' })
  if (error) throw error
}

/* ------------------------------------------------- account + privacy bits */

export type AccountSettings = {
  translationLanguage: LanguageCode
  isPrivate: boolean
  friendsListVisible: boolean
}

export async function getAccountSettings(
  userId: string
): Promise<AccountSettings> {
  const client = requireClient()

  const { data, error } = await client
    .from('profiles')
    .select('translation_language, friends_list_visible, is_private')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    // pre-0022: is_private doesn't exist yet, so ask for the rest.
    if (isNotMigrated(error)) {
      const { data: partial, error: partialErr } = await client
        .from('profiles')
        .select('translation_language, friends_list_visible')
        .eq('id', userId)
        .maybeSingle()
      if (partialErr) throw partialErr
      return {
        translationLanguage: (partial?.translation_language ?? 'en') as LanguageCode,
        friendsListVisible: partial?.friends_list_visible ?? true,
        isPrivate: false,
      }
    }
    throw error
  }

  return {
    translationLanguage: (data?.translation_language ?? 'en') as LanguageCode,
    friendsListVisible: data?.friends_list_visible ?? true,
    isPrivate: data?.is_private ?? false,
  }
}

export async function updateAccountSettings(
  userId: string,
  patch: Partial<{
    translation_language: LanguageCode
    friends_list_visible: boolean
    is_private: boolean
  }>
) {
  const { error } = await requireClient()
    .from('profiles')
    .update(patch)
    .eq('id', userId)
  if (error) throw error
}
