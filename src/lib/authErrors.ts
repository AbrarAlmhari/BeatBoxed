/**
 * Supabase returns terse, sometimes technical auth errors. Map the ones users
 * actually hit to plain language; fall back to the raw message so nothing is
 * silently swallowed during development.
 */
export function authErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error ?? 'Something went wrong.')

  const m = raw.toLowerCase()

  if (m.includes('invalid login credentials')) {
    return "That email and password don't match an account. Check both and try again."
  }
  if (m.includes('email not confirmed')) {
    return 'Confirm your email first — check your inbox for the link we sent.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'An account with this email already exists. Try logging in instead.'
  }
  if (m.includes('password should be at least')) {
    return 'Password must be at least 6 characters.'
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'That email address looks invalid.'
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Too many attempts. Wait a minute, then try again.'
  }
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  if (m.includes('supabase is not configured')) {
    return 'Supabase keys are missing. Copy .env.example to .env.local and fill them in.'
  }

  return raw
}
