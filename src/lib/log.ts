/**
 * One log format for the app: a short tag for the area, what happened, then
 * the useful ids and the error as one object:
 *
 *   [playlist] cover upload failed { playlist: '…', error: 'StorageError: …' }
 *
 * Errors become their message (with a database error's code, details and
 * hint, and a function failure's status). Text is cut to 300 characters and
 * email addresses are replaced, so the browser console never shows a secret,
 * an email or a whole lyric. Never pass keys, tokens, lyrics or answers in.
 */

type Details = Record<string, unknown>

const MAX_VALUE = 300
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi

function clean(text: string) {
  const short = text.replace(EMAIL, '<email>')
  return short.length > MAX_VALUE ? `${short.slice(0, MAX_VALUE)}…` : short
}

function cleanValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return clean(v)
  if (v === null || typeof v !== 'object') return v
  if (v instanceof Error) {
    const extra = v as Error & { code?: unknown; details?: unknown; hint?: unknown; status?: unknown }
    const parts = [extra.status, extra.code, v.message, extra.details, extra.hint].filter((p) => p !== undefined && p !== null && p !== '')
    return clean(`${v.name}: ${parts.join(': ')}`)
  }
  if (depth > 4) return '[object]'
  if (Array.isArray(v)) return v.slice(0, 20).map((item) => cleanValue(item, depth + 1))
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, item]) => [k, cleanValue(item, depth + 1)]))
}

function write(method: 'error' | 'warn' | 'info', tag: string, what: string, details?: Details) {
  const line = `[${tag}] ${clean(what)}`
  if (details && Object.keys(details).length) console[method](line, cleanValue(details))
  else console[method](line)
}

export const logError = (tag: string, what: string, details?: Details) => write('error', tag, what, details)
export const logWarn = (tag: string, what: string, details?: Details) => write('warn', tag, what, details)
export const logInfo = (tag: string, what: string, details?: Details) => write('info', tag, what, details)
