/**
 * Beatie's AI service: Groq, through its OpenAI-compatible chat API.
 *
 * Same surface as provider.ts (generate, wasCutOff, currentModel, and its
 * types), so index.ts only imports from here instead. provider.ts stays as
 * it is: song-vibes still uses it, with Gemini, and nothing here touches it
 * beyond borrowing its types.
 */
import type { CallInfo, ChatMessage, GenerateOptions as BaseOptions, GenerateResult } from './provider.ts'

export type { CallInfo, ChatMessage, GenerateResult }

/**
 * provider.ts's options, plus `model`: a caller can pick its own model
 * (song-vibes, and Beatie's backup). Without it, GROQ_MODEL is used.
 */
export type GenerateOptions = BaseOptions & { model?: string }

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/** Supabase secret holding the key. Never sent to the browser. */
const KEY_SECRET = 'GROQ_API_KEY'

/**
 * The models come from secrets, read per request, so they can be changed
 * with `supabase secrets set` and no redeploy. The backup is tried once
 * when the primary is busy (index.ts decides when).
 */
const MODEL_SECRET = 'GROQ_MODEL'
const FALLBACK_MODEL_SECRET = 'GROQ_FALLBACK_MODEL'
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const DEFAULT_FALLBACK_MODEL = 'qwen/qwen3.8-27b'

/** The model a call will use: the override if given, otherwise GROQ_MODEL. */
export function currentModel(override?: string) {
  return override?.trim() || Deno.env.get(MODEL_SECRET)?.trim() || DEFAULT_MODEL
}

export function fallbackModel() {
  return Deno.env.get(FALLBACK_MODEL_SECRET)?.trim() || DEFAULT_FALLBACK_MODEL
}

/** How long to wait for the service unless the caller says otherwise. */
const DEFAULT_TIMEOUT_MS = 40_000

/**
 * Reasoning models count their reasoning in the same max_tokens as the
 * answer, so they get this much extra room on top of options.maxTokens, as
 * provider.ts does for Gemini's thinking, so reasoning can't use up the
 * answer's share and leave it cut off.
 */
const REASONING_HEADROOM = 1024

const isGptOss = (model: string) => model.startsWith('openai/gpt-oss')
const isQwen = (model: string) => model.startsWith('qwen/')

/** True when the service stopped because it ran out of room. */
export function wasCutOff(info: CallInfo) {
  return info.finishReason === 'length'
}

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

/**
 * JSON mode on Groq only allows an object at the top. When a caller wants
 * JSON, the model is told to put an array under "items", and that array is
 * handed back as the text, so callers expecting a bare array (the
 * translation) see exactly that.
 */
const JSON_NOTE =
  'Your reply must be a single JSON object. If you were asked for a JSON array, reply with {"items": <that array>} and nothing else.'

function unwrapJson(text: string) {
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value)
      if (keys.length === 1 && Array.isArray(value[keys[0]])) return JSON.stringify(value[keys[0]])
    }
  } catch {
    // Not JSON: leave it for the caller to reject.
  }
  return text
}

/**
 * Streams the answer, so how far it got is known even when the wait runs
 * out, and logs what it cost in the same line format as provider.ts, with
 * the provider named. options.model picks a model other than GROQ_MODEL;
 * the signature is otherwise the same as provider.ts.
 */
export async function generate(
  systemPrompt: string,
  messages: ChatMessage[],
  options: GenerateOptions
): Promise<GenerateResult> {
  const key = Deno.env.get(KEY_SECRET)
  if (!key) return { ok: false, reason: 'error', detail: `${KEY_SECRET} is not set` }

  const label = options.label ?? 'call'
  const model = currentModel(options.model)
  const reasoning = isGptOss(model) || isQwen(model)
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: options.json ? `${systemPrompt}\n\n${JSON_NOTE}` : systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.text })),
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens + (reasoning ? REASONING_HEADROOM : 0),
    stream: true,
    stream_options: { include_usage: true },
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    ...(isGptOss(model) ? { reasoning_effort: 'low' } : {}),
    // Keep Qwen's reasoning out of the answer text.
    ...(isQwen(model) ? { reasoning_format: 'hidden' } : {}),
  }

  const started = Date.now()
  let text = ''
  let finishReason: string | null = null
  let usage: Usage = {}
  let firstChunkMs: number | null = null
  const info = (): CallInfo => ({
    finishReason,
    thinkingTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    answerTokens: usage.completion_tokens ?? null,
    promptTokens: usage.prompt_tokens ?? null,
    ms: Date.now() - started,
    firstChunkMs,
    chars: text.length,
  })
  const describe = (i: CallInfo) =>
    `model=${model} finish=${i.finishReason ?? '-'} thinking=${i.thinkingTokens ?? '?'} answer=${i.answerTokens ?? '?'} prompt=${i.promptTokens ?? '?'} ms=${i.ms} firstChunkMs=${i.firstChunkMs ?? '-'} chars=${i.chars}`

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    })
    if (res.status === 429 || res.status >= 500) {
      console.error(`[beatie] groq ${label}: model=${model} HTTP ${res.status}`)
      return { ok: false, reason: 'busy', detail: `HTTP ${res.status}`, info: info() }
    }
    if (!res.ok || !res.body) {
      const detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      console.error(`[beatie] groq ${label}: model=${model} ${detail}`)
      return { ok: false, reason: 'error', detail, info: info() }
    }

    // Server-sent events: each "data: {...}" line is a piece of the answer;
    // "data: [DONE]" ends the stream.
    let buffer = ''
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        const event = JSON.parse(data)
        if (event?.error) {
          // An error reported mid-stream: rate limits are worth a retry.
          const message = String(event.error.message ?? event.error.code ?? 'stream error')
          const busy = /rate|limit|overloaded|capacity/i.test(message)
          console.error(`[beatie] groq ${label}: model=${model} stream error: ${message.slice(0, 200)}`)
          return { ok: false, reason: busy ? 'busy' : 'error', detail: message, info: info() }
        }
        const choice = event?.choices?.[0]
        const piece = choice?.delta?.content
        if (typeof piece === 'string' && piece) {
          if (firstChunkMs === null) firstChunkMs = Date.now() - started
          text += piece
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const u = event?.usage ?? event?.x_groq?.usage
        if (u) usage = u
      }
    }
  } catch (err) {
    // Timeouts and network failures: the service isn't answering in time.
    const i = info()
    console.warn(
      `[beatie] groq ${label}: gave up after ${i.ms}ms (${(err as Error).name}): ${describe(i)} last100=${JSON.stringify(text.slice(-100))}`
    )
    return { ok: false, reason: 'busy', detail: (err as Error).message, info: i }
  }

  const i = info()
  console.log(`[beatie] groq ${label}: ${describe(i)}`)
  // In case a model puts its reasoning in the text anyway.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!text) {
    return { ok: false, reason: 'error', detail: `no text (${finishReason ?? 'empty'})`, info: i }
  }
  if (options.json) text = unwrapJson(text)
  return { ok: true, text, info: i }
}
