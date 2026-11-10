import { test, expect } from './fixtures'
import { logError, logWarn } from '../src/lib/log'

/**
 * The app's log format: "[tag] what happened", then one object with the ids
 * and the error, with emails replaced and long text cut short.
 */
function capture(run: () => void) {
  const seen: unknown[][] = []
  const real = { error: console.error, warn: console.warn }
  console.error = (...args: unknown[]) => void seen.push(['error', ...args])
  console.warn = (...args: unknown[]) => void seen.push(['warn', ...args])
  try {
    run()
  } finally {
    console.error = real.error
    console.warn = real.warn
  }
  return seen
}

test.describe('log format', () => {
  test('a tag, what happened, then the ids and the error', () => {
    const seen = capture(() => logError('playlist', 'cover upload failed', { playlist: 'p-1', error: new Error('too big') }))
    expect(seen).toEqual([['error', '[playlist] cover upload failed', { playlist: 'p-1', error: 'Error: too big' }]])
  })

  test('a database error keeps its code, details and hint', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505', details: 'on column x', hint: 'try y' })
    const [[, , details]] = capture(() => logWarn('song', 'like failed', { error: err }))
    expect(details).toEqual({ error: 'Error: 23505: duplicate key: on column x: try y' })
  })

  test("a function failure's status stays a field, for reading it in a test", () => {
    const [[, , details]] = capture(() => logError('catalog', 'spotify-search failed', { error: { status: 403, message: 'refused' } }))
    expect(JSON.stringify(details)).toContain('"status":403')
  })

  test('emails are replaced, at any depth', () => {
    const [[, line, details]] = capture(() =>
      logError('auth', 'sign-in failed for someone@example.com', { error: { message: 'no user other@example.org' } })
    )
    expect(JSON.stringify([line, details])).not.toMatch(/@example\./)
    expect(line).toBe('[auth] sign-in failed for <email>')
  })

  test('long text is cut to 300 characters', () => {
    const [[, , details]] = capture(() => logError('song', 'lyrics lookup failed', { error: new Error('x'.repeat(5000)) }))
    expect((details as { error: string }).error.length).toBeLessThanOrEqual(301)
  })

  test('without details, just the line', () => {
    expect(capture(() => logWarn('supabase', 'not configured'))).toEqual([['warn', '[supabase] not configured']])
  })
})
