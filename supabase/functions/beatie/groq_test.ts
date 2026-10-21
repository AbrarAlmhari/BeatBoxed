// Checks groq.ts against a fake Groq endpoint. No real calls.
// Run from supabase/functions: deno run --allow-env beatie/groq_test.ts
import { currentModel, fallbackModel, generate, wasCutOff } from './groq.ts'

Deno.env.set('GROQ_API_KEY', 'test-key')
const realFetch = globalThis.fetch
let lastBody: Record<string, unknown> = {}
let lastHeaders: Headers = new Headers()

function sse(events: unknown[]) {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
  // Split mid-line to exercise the buffering.
  const parts = [text.slice(0, 37), text.slice(37)]
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(new TextEncoder().encode(p))
      c.close()
    },
  })
}

function fake(respond: () => Response | Promise<Response>) {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body ?? '{}'))
    lastHeaders = new Headers(init?.headers)
    const signal = init?.signal
    const r = respond()
    if (signal) {
      return await Promise.race([
        r,
        new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))),
      ])
    }
    return r
  }) as typeof fetch
}

const chunk = (content: string | null, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
  choices: [{ delta: content === null ? {} : { content }, finish_reason: finish }],
  ...extra,
})

const results: [string, boolean, string?][] = []
const check = (name: string, ok: boolean, detail = '') => results.push([name, ok, detail])

// 1. A normal answer, streamed.
fake(() => new Response(sse([chunk('Hello'), chunk(' there'), chunk(null, 'stop'), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } } }, '[DONE]'])))
let r = await generate('sys', [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }, { role: 'user', text: 'again' }], { maxTokens: 100, temperature: 0.7, label: 't1' })
check('streams and joins the answer', r.ok && r.text === 'Hello there', JSON.stringify(r))
check('stop is a complete answer', r.ok && !wasCutOff(r.info))
check('usage is read', r.ok && r.info.promptTokens === 10 && r.info.answerTokens === 20 && r.info.thinkingTokens === 5)
const msgs = lastBody.messages as { role: string; content: string }[]
check('system prompt first, roles kept', msgs[0].role === 'system' && msgs[0].content === 'sys' && msgs[1].role === 'user' && msgs[2].role === 'assistant')
check('gpt-oss: reasoning_effort low, headroom added', lastBody.reasoning_effort === 'low' && lastBody.max_tokens === 1124 && lastBody.temperature === 0.7)
check('primary model by default', lastBody.model === 'openai/gpt-oss-120b' && currentModel() === 'openai/gpt-oss-120b')
check('bearer key', lastHeaders.get('Authorization') === 'Bearer test-key')
check('no json mode unless asked', !('response_format' in lastBody))

// 2. Cut off.
fake(() => new Response(sse([chunk('Long'), chunk(null, 'length'), '[DONE]'])))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('length counts as cut off', r.ok && wasCutOff(r.info))

// 3. Busy and error statuses.
for (const status of [429, 500, 503]) {
  fake(() => new Response('nope', { status }))
  r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
  check(`HTTP ${status} is busy`, !r.ok && r.reason === 'busy')
}
fake(() => new Response('{"error":{"message":"model not found"}}', { status: 404 }))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('HTTP 404 is an error', !r.ok && r.reason === 'error')
fake(() => new Response('bad', { status: 400 }))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('HTTP 400 is an error', !r.ok && r.reason === 'error')

// 4. Timeout and network failure.
fake(() => new Promise<Response>(() => {}))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7, timeoutMs: 200 })
check('a timeout is busy', !r.ok && r.reason === 'busy', JSON.stringify(r))
globalThis.fetch = (() => Promise.reject(new TypeError('network down'))) as typeof fetch
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('a network failure is busy', !r.ok && r.reason === 'busy')

// 5. JSON: object mode, array unwrapped; backup model options.
fake(() => new Response(sse([chunk('{"items": ["uno",'), chunk(' "dos"]}'), chunk(null, 'stop'), '[DONE]'])))
r = await generate('sys', [{ role: 'user', text: '["one","two"]' }], { maxTokens: 50, temperature: 0.2, json: true, model: fallbackModel() })
check('json mode asks for an object', (lastBody.response_format as { type: string })?.type === 'json_object')
check('an array wrapped in an object comes back as the array', r.ok && r.text === '["uno","dos"]', JSON.stringify(r))
check('backup model: qwen, reasoning hidden, no reasoning_effort', lastBody.model === 'qwen/qwen3.8-27b' && lastBody.reasoning_format === 'hidden' && !('reasoning_effort' in lastBody))

// 6. A rate limit reported mid-stream, and think tags.
fake(() => new Response(sse([chunk('Hel'), { error: { message: 'Rate limit reached' } }])))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('a rate limit mid-stream is busy', !r.ok && r.reason === 'busy')
fake(() => new Response(sse([chunk('<think>hmm</think>Answer'), chunk(null, 'stop'), '[DONE]'])))
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('reasoning tags never reach the text', r.ok && r.text === 'Answer')

// 6b. song-vibes: a plain three-key object must come back untouched and
// pass song-vibes' own strict parseLabel (copied verbatim below).
const MOODS = ['sad', 'happy', 'nostalgic', 'romantic', 'angry', 'none']
const ENERGIES = ['low', 'mid', 'high']
function parseLabel(text: string) {
  let data: unknown
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  const keys = Object.keys(obj).sort().join(',')
  if (keys !== 'confidence,energy,lyrics_mood') return null
  const { lyrics_mood, energy, confidence } = obj
  if (typeof lyrics_mood !== 'string' || !MOODS.includes(lyrics_mood)) return null
  if (typeof energy !== 'string' || !ENERGIES.includes(energy)) return null
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  return { lyrics_mood, energy, confidence }
}
const vibe = '{"lyrics_mood": "sad", "energy": "low", "confidence": 0.82}'
fake(() => new Response(sse([chunk(vibe.slice(0, 20)), chunk(vibe.slice(20)), chunk(null, 'stop'), '[DONE]'])))
r = await generate('label', [{ role: 'user', text: 'Title: x' }], { maxTokens: 120, temperature: 0.2, json: true, model: 'openai/gpt-oss-20b' })
check('vibes: plain object returned unchanged', r.ok && r.text === vibe, JSON.stringify(r))
check('vibes: passes parseLabel', r.ok && JSON.stringify(parseLabel(r.text)) === '{"lyrics_mood":"sad","energy":"low","confidence":0.82}')
check('vibes: own model, json object mode, reasoning low', lastBody.model === 'openai/gpt-oss-20b' && (lastBody.response_format as { type: string })?.type === 'json_object' && lastBody.reasoning_effort === 'low' && lastBody.max_tokens === 1144)
check('override does not stick: next call without model uses GROQ_MODEL', currentModel() === 'openai/gpt-oss-120b' && currentModel('openai/gpt-oss-20b') === 'openai/gpt-oss-20b')
// An object with a single non-array key is not unwrapped either.
fake(() => new Response(sse([chunk('{"lyrics_mood": "sad"}'), chunk(null, 'stop'), '[DONE]'])))
r = await generate('label', [{ role: 'user', text: 'x' }], { maxTokens: 120, temperature: 0.2, json: true })
check('single non-array key left alone (parseLabel then rejects it)', r.ok && r.text === '{"lyrics_mood": "sad"}' && parseLabel(r.text) === null)

// 7. Missing key; model secrets.
Deno.env.delete('GROQ_API_KEY')
r = await generate('sys', [{ role: 'user', text: 'hi' }], { maxTokens: 10, temperature: 0.7 })
check('no key is an error', !r.ok && r.reason === 'error')
Deno.env.set('GROQ_MODEL', 'openai/gpt-oss-20b')
Deno.env.set('GROQ_FALLBACK_MODEL', 'qwen/other')
check('models come from the secrets', currentModel() === 'openai/gpt-oss-20b' && fallbackModel() === 'qwen/other')

globalThis.fetch = realFetch
const failed = results.filter(([, ok]) => !ok)
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
