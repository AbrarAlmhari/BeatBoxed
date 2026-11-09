// Runs beatie as a real local server, against a fake Groq, lyrics lookup, login
// service and database. No real calls: anything else it tries to reach fails
// the run.
// Run with: npm run test:beatie
const SUPABASE = 'http://supabase.test'
const USER_TOKEN = 'test-user-session'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const SONG_ID = '00000000-0000-4000-8000-000000000002'
const MAIN = 'openai/gpt-oss-120b'
const BACKUP = 'qwen/qwen3.8-27b'

Deno.env.set('SUPABASE_URL', SUPABASE)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role')
Deno.env.set('SUPABASE_ANON_KEY', 'test-public-key')
Deno.env.set('GROQ_API_KEY', 'test-groq-key')
Deno.env.set('GROQ_MODEL', MAIN)
Deno.env.set('GROQ_FALLBACK_MODEL', BACKUP)

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/* --------------------------------------------------------- the fakes */

const answer = (text: string) =>
  new Response(
    [
      { choices: [{ delta: { content: text }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  )
const minuteLimit = () => jsonResponse({ error: { message: 'Rate limit reached on tokens per minute (TPM): Limit 8000' } }, 429)
const dayLimit = () => jsonResponse({ error: { message: 'Rate limit reached on tokens per day (TPD): Limit 200000, Used 199999' } }, 429)
const serverDown = () => new Response('down', { status: 503 })
const midAnswerFailure = () => new Response(`data: ${JSON.stringify({ error: { message: 'something broke' } })}\n\n`)

type Groq = (body: { model: string; max_tokens: number; messages: { content: string }[] }) => Response
let groq: Groq = () => answer('A fine answer.')
const groqCalls: { model: string; max_tokens: number; prompt: number }[] = []
let lyricLinesForSong = ['first line of the song', 'second line of the song']

const counts = { user: 0, app: 0 }
const limits = { conflictNext: false }
const cache = new Map<string, Record<string, unknown>>()
const unexpected: string[] = []
const realFetch = globalThis.fetch

const cacheKey = (url: URL) => ['kind', 'line_key', 'language'].map((k) => url.searchParams.get(k)?.replace(/^eq\./, '')).join('|')

async function fakeDatabase(request: Request, url: URL) {
  const table = url.pathname.replace('/rest/v1/', '')
  if (table === 'songs') {
    return jsonResponse([{ id: SONG_ID, title: 'Fake Song', artists: { name: 'Fake Artist' }, albums: { title: 'Fake Album', release_date: '2020-01-01' } }])
  }
  if (table === 'profiles') return jsonResponse([{ translation_language: 'en' }])
  if (table === 'rpc/beatie_take_quota') {
    const { p_user, p_user_limit, p_global_limit } = await request.json()
    if (p_user && counts.user >= p_user_limit) return jsonResponse('user_limit')
    if (counts.app >= p_global_limit) return jsonResponse('global_limit')
    if (p_user) counts.user++
    counts.app++
    return jsonResponse('ok')
  }
  if (table === 'beatie_usage' || table === 'beatie_global_usage') {
    const key = table === 'beatie_usage' ? 'user' : 'app'
    if (request.method === 'GET') return jsonResponse([{ count: counts[key] }])
    // PATCH: only if the count hasn't moved, like the real filter.
    if (limits.conflictNext) {
      limits.conflictNext = false
      return jsonResponse([])
    }
    if (url.searchParams.get('count') !== `eq.${counts[key]}`) return jsonResponse([])
    const { count } = await request.json()
    counts[key] = count
    return jsonResponse([{ count }])
  }
  if (table === 'beatie_cache') {
    const key = cacheKey(url)
    if (request.method === 'GET') return jsonResponse(cache.has(key) ? [cache.get(key)] : [])
    if (request.method === 'DELETE') {
      cache.delete(key)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'PATCH') {
      const row = cache.get(key)
      if (row) Object.assign(row, await request.json())
      return new Response(null, { status: 204 })
    }
    const sent = (await request.json()) as Record<string, string> | Record<string, string>[]
    const row = Array.isArray(sent) ? sent[0] : sent
    const rowKey = [row.kind, row.line_key, row.language].join('|')
    if (cache.has(rowKey)) return jsonResponse([])
    cache.set(rowKey, { content: row.content, has_lyrics: row.has_lyrics, created_at: new Date().toISOString() })
    return jsonResponse([{ id: 'cache-1' }])
  }
  unexpected.push(url.href)
  return jsonResponse({ message: 'unexpected table' }, 500)
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname === '127.0.0.1') return realFetch(input, init)
  if (url.host === 'api.groq.com') {
    const body = await request.json()
    const prompt = body.messages.reduce((n: number, m: { content: string }) => n + m.content.length, 0)
    groqCalls.push({ model: body.model, max_tokens: body.max_tokens, prompt })
    return groq(body)
  }
  if (url.origin === SUPABASE) {
    if (url.pathname === '/auth/v1/user') {
      return request.headers.get('authorization') === `Bearer ${USER_TOKEN}`
        ? jsonResponse({ id: USER_ID, aud: 'authenticated', role: 'authenticated' })
        : jsonResponse({ message: 'invalid JWT' }, 401)
    }
    if (url.pathname === '/functions/v1/lyrics-lookup') {
      return jsonResponse({ found: true, plainLyrics: lyricLinesForSong.join('\n') })
    }
    return fakeDatabase(request, url)
  }
  unexpected.push(url.href)
  throw new Error(`Unexpected call to ${url.href}`)
}) as typeof fetch

/* ------------------------------------------------------- the real server */

const logged: string[] = []
const realConsoleError = console.error
const realConsoleWarn = console.warn
const realConsoleLog = console.log
const quiet = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
console.error = quiet
console.warn = quiet

const realServe = Deno.serve
let listening = (_port: number) => {}
let server: { shutdown(): Promise<void> } | null = null
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (handler: (req: Request) => Response | Promise<Response>) => {
    server = realServe({ port: 0, hostname: '127.0.0.1', onListen: ({ port }) => listening(port) }, handler)
    return server
  },
})
const port = new Promise<number>((resolve) => (listening = resolve))
console.log = () => {}
await import('./beatie/index.ts')
const base = `http://127.0.0.1:${await port}`

async function ask(body: unknown) {
  const res = await globalThis.fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${USER_TOKEN}` },
    body: JSON.stringify(body),
  })
  return await res.json()
}
const chat = () => ask({ action: 'chat', songId: SONG_ID, messages: [{ role: 'user', text: 'What is this about?' }] })
const explain = () => ask({ action: 'explain', songId: SONG_ID })
const translate = () => ask({ action: 'translate', songId: SONG_ID })

/** Each model's answer, by name. */
const models = (main: () => Response, backup: () => Response): Groq => (body) => (body.model === MAIN ? main() : backup())

function reset(next: Groq) {
  groq = next
  counts.user = 0
  counts.app = 0
  limits.conflictNext = false
  groqCalls.length = 0
  cache.clear()
  lyricLinesForSong = ['first line of the song', 'second line of the song']
}

/* ------------------------------------------------------------ the checks */

const results: [string, boolean, string?][] = []
const check = (name: string, ok: boolean, detail?: unknown) => results.push([name, ok, detail === undefined ? undefined : JSON.stringify(detail)])
const charged = (user: number, app: number) => counts.user === user && counts.app === app

// A normal answer
reset(() => answer('A fine answer.'))
let r = await chat()
check('one model answers: one request charged', r.ok === true && charged(1, 1), { r, counts })

// Both models refuse: nothing charged
reset(minuteLimit)
r = await chat()
check('both over the minute limit: "busy", nothing charged', r.code === 'busy' && charged(0, 0), { r, counts })
check('both were really tried', groqCalls.map((c) => c.model).join() === `${MAIN},${BACKUP}`, groqCalls)

reset(dayLimit)
r = await chat()
check('both over the daily limit: "daily", nothing charged', r.code === 'daily' && charged(0, 0), { r, counts })

reset(models(serverDown, minuteLimit))
r = await chat()
check('one down, one rate limited: "busy", nothing charged', r.code === 'busy' && charged(0, 0), { r, counts })

reset(models(dayLimit, serverDown))
r = await chat()
check('only one over the daily limit: "busy", not "daily"', r.code === 'busy' && charged(0, 0), { r, counts })

counts.user = 7
counts.app = 40
groq = dayLimit
r = await chat()
check('earlier requests today stay counted', r.code === 'daily' && charged(7, 40), { r, counts })

// The backup answers, or a model did some work: the charge stays
reset(models(dayLimit, () => answer('From the backup.')))
r = await chat()
check('the backup answers: the answer is shown and both calls count', r.ok === true && r.text === 'From the backup.' && charged(1, 2), { r, counts })

reset(models(minuteLimit, midAnswerFailure))
r = await chat()
check('the backup fails partway: the charge stays', r.ok === false && charged(1, 2), { r, counts })

reset(models(midAnswerFailure, minuteLimit))
r = await chat()
check('the main model fails partway: the charge stays', r.ok === false && charged(1, 1), { r, counts })

// The caps themselves are unchanged
reset(() => answer('A fine answer.'))
counts.user = 30
r = await chat()
check('a user at 30 is refused, and Groq is not called', r.code === 'limit' && groqCalls.length === 0, { r, groqCalls })

reset(() => answer('A fine answer.'))
counts.app = 150
r = await chat()
check('the app at 150 is refused, and Groq is not called', r.code === 'global' && groqCalls.length === 0, { r, groqCalls })

reset(models(minuteLimit, () => answer('never')))
counts.app = 149
r = await chat()
check('no room left for the backup: "global", and the refused call is given back', r.code === 'global' && charged(0, 149), { r, counts })

// Giving back doesn't lose another request's count
reset(dayLimit)
limits.conflictNext = true
r = await chat()
check('a count that moved is read again and still given back', r.code === 'daily' && charged(0, 0), { r, counts })

// Answers that are cached
reset(dayLimit)
r = await explain()
check('explain, daily limit: "daily", nothing charged', r.code === 'daily' && charged(0, 0), { r, counts })
check('it holds no failure for two minutes: the next tap tries again', cache.size === 0, [...cache.entries()])

groq = () => answer('Now it works.')
r = await explain()
check('so an answer comes as soon as there is room', r.ok === true && r.text === 'Now it works.' && charged(1, 1), { r, counts })

reset(minuteLimit)
r = await explain()
check('explain, both busy: "busy", nothing charged', r.code === 'busy' && charged(0, 0), { r, counts })
const callsSoFar = groqCalls.length
r = await explain()
check('the next tap within two minutes is "busy" and calls nobody', r.code === 'busy' && groqCalls.length === callsSoFar, { r, groqCalls })

reset(dayLimit)
r = await translate()
check('translate, daily limit: "daily", nothing charged', r.code === 'daily' && charged(0, 0), { r, counts })

// How long a translation may be
const songOf = (chars: number) => {
  const line = 'a lyric line of about thirty c'
  return Array.from({ length: Math.ceil(chars / (line.length + 1)) }, () => line)
}
const translated = (count: number) => answer(JSON.stringify({ items: Array.from({ length: count }, () => 'x') }))

for (const chars of [500, 2000, 4406, 8000]) {
  reset(() => answer(''))
  lyricLinesForSong = songOf(chars)
  groq = () => translated(lyricLinesForSong.length)
  r = await translate()
  const call = groqCalls[0]
  // Arabic runs near 2 characters a token, the safe side.
  const requested = call.max_tokens + Math.ceil(call.prompt / 2)
  check(`translate, ${chars} characters: asks for ${requested} tokens in all, under the 8,000 a minute`, requested < 8000 && call.max_tokens > 1024, call)
  if (chars <= 4406) {
    check(`translate, ${chars} characters: leaves room for a whole answer`, call.max_tokens - 1024 >= Math.min(chars, 8000) / 2, call)
  }
}

reset(() => answer(''))
lyricLinesForSong = songOf(1000)
groq = () => translated(lyricLinesForSong.length)
await translate()
check('a short song keeps the limit it had', groqCalls[0].max_tokens === 200 + lyricLinesForSong.join(' ').length * 2 + 1024, groqCalls[0])

check('nothing else was called', unexpected.length === 0, unexpected)

/* ---------------------------------------------------------------- result */

console.error = realConsoleError
console.warn = realConsoleWarn
console.log = realConsoleLog
await (server as { shutdown(): Promise<void> } | null)?.shutdown()
globalThis.fetch = realFetch
const failed = results.filter(([, ok]) => !ok)
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
Deno.exit(failed.length ? 1 : 0)
