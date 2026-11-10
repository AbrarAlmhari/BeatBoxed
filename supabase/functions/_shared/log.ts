/**
 * One log format for every Edge Function: a short tag, what happened, then
 * the useful ids and details as key=value, on one line:
 *
 *   [beatie] cache write failed song=4915e7d5 error="23505: duplicate key"
 *
 * Errors become their message (with a database error's code, details and
 * hint). Every value is cut to 300 characters and email addresses are
 * replaced, so a log line can't carry a secret, an email or a whole lyric.
 * Never pass keys, tokens, lyrics or answers in.
 */

type Details = Record<string, unknown>

const MAX_VALUE = 300
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi

function clean(text: string) {
  const short = text.replace(EMAIL, '<email>')
  return short.length > MAX_VALUE ? `${short.slice(0, MAX_VALUE)}…` : short
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const extra = err as Error & { code?: unknown; details?: unknown; hint?: unknown }
    const parts = [extra.code, err.message, extra.details, extra.hint].filter((p) => p !== undefined && p !== null && p !== '')
    return `${err.name === 'Error' ? '' : `${err.name}: `}${parts.join(': ')}`
  }
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; status?: unknown }
    if ('message' in e) {
      return [e.status, e.code, e.message, e.details, e.hint].filter((p) => p !== undefined && p !== null && p !== '').join(': ')
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

function value(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const text = clean(typeof v === 'string' ? v : describeError(v))
  return /^[\w.:/@+-]*$/.test(text) && text !== '' ? text : JSON.stringify(text)
}

export function logLine(tag: string, what: string, details: Details = {}) {
  const pairs = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${value(v)}`)
  return [`[${tag}] ${clean(what)}`, ...pairs].join(' ')
}

export const logError = (tag: string, what: string, details?: Details) => console.error(logLine(tag, what, details))
export const logWarn = (tag: string, what: string, details?: Details) => console.warn(logLine(tag, what, details))
export const logInfo = (tag: string, what: string, details?: Details) => console.log(logLine(tag, what, details))
