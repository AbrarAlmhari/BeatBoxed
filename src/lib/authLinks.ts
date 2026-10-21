/**
 * Where the links in auth emails (sign-up confirmation, resend, password
 * reset) send people, and what such a link brought with it.
 *
 * In production every link uses one fixed address, VITE_SITE_URL, so an
 * email never points at a preview deployment that has since expired, or at
 * whatever other address the app happened to be opened on. Only on this
 * computer (localhost) does it use the current address, so local testing
 * comes back to the local app.
 *
 * Supabase only follows a link whose address is in the project's Redirect
 * URLs list (Authentication → URL Configuration); otherwise it falls back to
 * the Site URL.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The address auth emails link back to, without a trailing slash. */
export function siteUrl() {
  const { origin, hostname } = window.location
  if (LOCAL_HOSTS.has(hostname)) return origin
  const fixed = import.meta.env.VITE_SITE_URL?.trim().replace(/\/+$/, '')
  if (fixed) return fixed
  console.warn('[beatboxed] VITE_SITE_URL is not set, so email links use this address:', origin)
  return origin
}

/** A full link to one of the app's pages, e.g. authRedirect('/welcome'). */
export function authRedirect(path: string) {
  return `${siteUrl()}${path}`
}

/**
 * What the email link put in the address. Read once, when the app loads,
 * before Supabase tidies the address bar: supabase.ts imports this module,
 * so it runs first.
 *
 * A reset link arrives as #access_token=…&type=recovery. An expired or
 * already used one arrives as #error=access_denied&error_code=otp_expired
 * (or in the query string, depending on the link).
 */
function readArrival() {
  if (typeof window === 'undefined') return { recovery: false, errorCode: null as string | null }
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const get = (key: string) => hash.get(key) ?? query.get(key)
  return {
    recovery: get('type') === 'recovery',
    errorCode: get('error_code') ?? get('error'),
  }
}

export const arrival = readArrival()

/**
 * Remembers, for this tab, that it was opened from a reset link, so the
 * reset page still shows its form after a refresh (the link's part of the
 * address is gone by then). Cleared once the password is saved.
 */
const RECOVERY_KEY = 'beatboxed:password-recovery'

if (arrival.recovery) {
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1')
  } catch {
    // Storage blocked: the form still shows on this visit.
  }
}

export function inRecovery() {
  if (arrival.recovery) return true
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

export function endRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY)
  } catch {
    // Nothing to clear.
  }
}
