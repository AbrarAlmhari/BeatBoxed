/**
 * Groq, through its OpenAI-compatible chat API: the only model service
 * Beatie and song-vibes use. Everything Groq-specific lives here (models,
 * endpoint, request and response format, secret names), behind generate(),
 * wasCutOff() and currentModel().
 */

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

export type GenerateOptions = {
  /** Upper bound on the answer's length. */
  maxTokens: number
  /** Lower is steadier; translation wants it low. */
  temperature: number
  /** Ask for a JSON response (used for translations). */
  json?: boolean
  /** How long to wait for Groq before giving up as 'busy'. */
  timeoutMs?: number
  /** Names the call in the logs, e.g. "explain 4915e7d5 ar". */
  label?: string
  /**
   * A model other than GROQ_MODEL (song-vibes, and Beatie's backup).
   * Without it, GROQ_MODEL is used.
   */
  model?: string
}

/** What a call cost and how it ended. Logged, never shown to users. */
export type CallInfo = {
  /** 'stop' is a complete answer; 'length' means it was cut off. */
  finishReason: string | null
  /** Reasoning tokens, when Groq reports them. */
  thinkingTokens: number | null
  answerTokens: number | null
  promptTokens: number | null
  ms: number
  /** Until the first piece of the answer arrived. */
  firstChunkMs: number | null
  chars: number
}

/**
 * busy:  Groq is down, overloaded, rate limiting us or too slow, worth
 *        trying again in a minute.
 * error: anything else (empty answer, bad config).
 *
 * On a failure, `modelGone`: Groq says the model doesn't exist or has been
 * retired, so the backup is worth a try. `refused`: Groq turned the request
 * down without answering (rate limit, server error, model gone), so no
 * tokens were spent on it. `dailyLimit` is a refusal because a per-day
 * limit is used up.
 */
export type GenerateResult =
  | { ok: true; text: string; info: CallInfo }
  | {
      ok: false
      reason: 'busy' | 'error'
      detail: string
      info?: CallInfo
      modelGone?: boolean
      refused?: boolean
      dailyLimit?: boolean
    }

import {
  GROQ_DEFAULT_FALLBACK_MODEL as DEFAULT_FALLBACK_MODEL,
  GROQ_DEFAULT_MODEL as DEFAULT_MODEL,
  GROQ_DEFAULT_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
  REASONING_HEADROOM,
} from '../_shared/config.ts'

export { REASONING_HEADROOM }

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/** Supabase secret holding the key. Never sent to the browser. */
const KEY_SECRET = 'GROQ_API_KEY'

/**
 * The models come from secrets, read per request, so they can be changed
 * with `supabase secrets set` and no redeploy. The backup is tried once
 * when the primary is busy or Groq says it's gone (index.ts decides when).
 * The defaults, used when a secret isn't set, are in _shared/config.ts.
 */
const MODEL_SECRET = 'GROQ_MODEL'
const FALLBACK_MODEL_SECRET = 'GROQ_FALLBACK_MODEL'

/** The model a call will use: the override if given, otherwise GROQ_MODEL. */
export function currentModel(override?: string) {
  return override?.trim() || Deno.env.get(MODEL_SECRET)?.trim() || DEFAULT_MODEL
}

export function fallbackModel() {
  return Deno.env.get(FALLBACK_MODEL_SECRET)?.trim() || DEFAULT_FALLBACK_MODEL
}


/**
 * Groq's rate limits as its last answer reported them (its x-ratelimit-*
 * headers): requests per day, tokens per minute, and what's left of each.
 * Null until a call has been made; a field is null when the header was
 * missing.
 */
export type RateLimits = {
  model: string
  requestsPerDay: number | null
  requestsLeftToday: number | null
  requestsResetIn: string | null
  tokensPerMinute: number | null
  tokensLeftThisMinute: number | null
  tokensResetIn: string | null
  seenAt: string
}

let rateLimits: RateLimits | null = null

export function lastRateLimits() {
  return rateLimits
}

function readRateLimits(res: Response, model: string) {
  const num = (name: string) => {
    const v = res.headers.get(name)
    return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
  }
  if (!res.headers.has('x-ratelimit-limit-requests') && !res.headers.has('x-ratelimit-limit-tokens')) return
  rateLimits = {
    model,
    requestsPerDay: num('x-ratelimit-limit-requests'),
    requestsLeftToday: num('x-ratelimit-remaining-requests'),
    requestsResetIn: res.headers.get('x-ratelimit-reset-requests'),
    tokensPerMinute: num('x-ratelimit-limit-tokens'),
    tokensLeftThisMinute: num('x-ratelimit-remaining-tokens'),
    tokensResetIn: res.headers.get('x-ratelimit-reset-tokens'),
    seenAt: new Date().toISOString(),
  }
}

const isGptOss = (model: string) => model.startsWith('openai/gpt-oss')
const isQwen = (model: string) => model.startsWith('qwen/')

/**
 * Groq's answer when the model name is unknown (404, model_not_found) or
 * the model has been retired (400, model_decommissioned).
 */
function isModelGone(status: number, body: string) {
  return status === 404 || /model_not_found|decommissioned/i.test(body)
}

/** Whether the backup model is worth a try after this result. */
export function backupWorthTrying(result: GenerateResult) {
  return !result.ok && (result.reason === 'busy' || result.modelGone === true)
}

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
 * out, and logs what it cost. options.model picks a model other than
 * GROQ_MODEL.
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
    readRateLimits(res, model)
    if (res.status === 429 || res.status >= 500) {
      // Groq's message names the limit that was hit. Logged so its wording can
      // be checked; anything not recognised as a daily limit is just 'busy'.
      const message = (await res.text().catch(() => '')).slice(0, 300)
      const dailyLimit = res.status === 429 && /per day|\b(TPD|RPD)\b/i.test(message)
      console.error(`[beatie] groq ${label}: model=${model} HTTP ${res.status}: ${message}`)
      return {
        ok: false,
        reason: 'busy',
        detail: `HTTP ${res.status}`,
        info: info(),
        refused: true,
        ...(dailyLimit ? { dailyLimit } : {}),
      }
    }
    if (!res.ok || !res.body) {
      const text = res.ok ? '' : await res.text()
      const detail = `HTTP ${res.status}: ${text.slice(0, 300)}`
      console.error(`[beatie] groq ${label}: model=${model} ${detail}`)
      const modelGone = !res.ok && isModelGone(res.status, text)
      return { ok: false, reason: 'error', detail, info: info(), ...(modelGone ? { modelGone, refused: true } : {}) }
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
