// The Edge Functions' log format: a short tag, what happened, then key=value
// details on one line, with no emails and nothing longer than 300 characters.
// Run with: npm run test:logs
import { logLine } from './_shared/log.ts'

const results: [string, boolean, string][] = []
const check = (name: string, ok: boolean, got: string) => results.push([name, ok, got])

let line = logLine('beatie', 'cache write failed', { song: 'abc-123', kind: 'explain', language: 'ar' })
check('tag, what happened, then the ids', line === '[beatie] cache write failed song=abc-123 kind=explain language=ar', line)

line = logLine('auth', 'session check failed', { error: new Error('could not reach auth') })
check('an error becomes its message, quoted', line === '[auth] session check failed error="could not reach auth"', line)

line = logLine('spotify-search', 'request failed', { error: { code: '23505', message: 'duplicate key', details: 'on column x', hint: 'try y' } })
check("a database error keeps its code, details and hint", line.includes('23505: duplicate key: on column x: try y'), line)

line = logLine('auth', 'session check failed', { error: new Error('user someone@example.com not found') })
check('emails are replaced', !line.includes('someone@example.com') && line.includes('<email>'), line)

line = logLine('groq', 'refused', { message: 'x'.repeat(1000) })
check('long values are cut to 300 characters', line.length < 340 && line.includes('…'), line)

line = logLine('beatie', 'no answer', { reason: 'busy', detail: undefined, empty: '', none: null, count: 0, ok: false })
check('empty values are left out, numbers and booleans kept', line === '[beatie] no answer reason=busy count=0 ok=false', line)

line = logLine('song-vibes', 'run finished', { summary: JSON.stringify({ claimed: 2 }) })
check('a JSON summary is quoted', line === '[song-vibes] run finished summary="{\\"claimed\\":2}"', line)

const failed = results.filter(([, ok]) => !ok)
for (const [name, ok, got] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${got}`}`)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
Deno.exit(failed.length ? 1 : 0)
