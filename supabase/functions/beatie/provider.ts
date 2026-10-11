/**
 * The only file that knows which AI service Beatie uses.
 *
 * Everything Gemini-specific lives here: the model, the endpoint, the
 * request and response shapes, and the key's secret name. The rest of the
 * function talks to generate() and nothing else, so moving to another
 * provider means rewriting this file and setting a different secret.
 */

/**
 * The model comes from the GEMINI_MODEL secret, so it can be changed with
 * `supabase secrets set GEMINI_MODEL=...` and no redeploy. This is the
 * fallback when the secret isn't set: a Flash model on the free tier,
 * confirmed with this key's list-models endpoint on 2026-10-11 (it supports
 * generateContent). gemini-2.5-flash, the first choice, now answers 404 for
 * new users.
 */
const FALLBACK_MODEL = 'gemini-3.8-flash'
const MODEL_SECRET = 'GEMINI_MODEL'

/** Supabase secret holding the key. Never sent to the browser. */
const KEY_SECRET = 'GEMINI_API_KEY'

/** Read per request, so a changed secret takes effect without a redeploy. */
export function currentModel() {
  return Deno.env.get(MODEL_SECRET)?.trim() || FALLBACK_MODEL
}

/** How long to wait for the provider unless the caller says otherwise. */
const DEFAULT_TIMEOUT_MS = 40_000

/**
 * How hard the model thinks before answering. Gemini 3 models take
 * generationConfig.thinkingConfig.thinkingLevel; for gemini-3.8-flash the
 * accepted values are low, medium (its default) and high — thinking can't be
 * turned off, and "minimal" is rejected with an error. Beatie's answers are
 * short, so the lowest level keeps them quick: at the default, a long song
 * ran past the 25-second wait. A different GEMINI_MODEL may need a different
 * setting here (Gemini 2.5 models use thinkingBudget instead).
 * Source: https://ai.google.dev/gemini-api/docs/generate-content/thinking
 */
const THINKING_LEVEL = 'low'

/**
 * Thinking tokens come out of the same maxOutputTokens as the answer, so
 * every request gets this much extra room, so thinking can't use up the
 * answer's share and leave it empty.
 */
const THINKING_HEADROOM = 2048

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

export type GenerateOptions = {
  /** Upper bound on the answer's length. */
  maxTokens: number
  /** Lower is steadier; translation wants it low. */
  temperature: number
  /** Ask for a JSON response (used for translations). */
  json?: boolean
  /** How long to wait for the provider before giving up as 'busy'. */
  timeoutMs?: number
  /** Names the call in the logs, e.g. "explain 4915e7d5 ar". */
  label?: string
}

/** What a call cost and how it ended. Logged, never shown to users. */
export type CallInfo = {
  /** STOP is a complete answer; MAX_TOKENS means it was cut off. */
  finishReason: string | null
  thinkingTokens: number | null
  answerTokens: number | null
  promptTokens: number | null
  ms: number
  /** Until the first piece of the answer arrived. */
  firstChunkMs: number | null
  chars: number
}

/**
 * busy:  the provider is down, overloaded, rate limiting us or too slow —
 *        worth trying again in a minute.
 * error: anything else (blocked answer, empty answer, bad config).
 */
export type GenerateResult =
  | { ok: true; text: string; info: CallInfo }
  | { ok: false; reason: 'busy' | 'error'; detail: string; info?: CallInfo }

/** True when the provider stopped because it ran out of room. */
export function wasCutOff(info: CallInfo) {
  return info.finishReason === 'MAX_TOKENS'
}

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }

/**
 * Streams the answer, so how far it got is known even when the wait runs
 * out, and logs what it cost: thinking and answer tokens, finish reason and
 * time. On a timeout it logs the tokens so far and the last ~100 characters
 * received.
 */
export async function generate(
  systemPrompt: string,
  messages: ChatMessage[],
  options: GenerateOptions
): Promise<GenerateResult> {
  const key = Deno.env.get(KEY_SECRET)
  if (!key) return { ok: false, reason: 'error', detail: `${KEY_SECRET} is not set` }

  const label = options.label ?? 'call'
  const model = currentModel()
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    })),
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens + THINKING_HEADROOM,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
    },
  }

  const started = Date.now()
  let text = ''
  let finishReason: string | null = null
  let blockReason: string | null = null
  let usage: Usage = {}
  let firstChunkMs: number | null = null
  const info = (): CallInfo => ({
    finishReason,
    thinkingTokens: usage.thoughtsTokenCount ?? null,
    answerTokens: usage.candidatesTokenCount ?? null,
    promptTokens: usage.promptTokenCount ?? null,
    ms: Date.now() - started,
    firstChunkMs,
    chars: text.length,
  })
  const describe = (i: CallInfo) =>
    `model=${model} finish=${i.finishReason ?? '-'} thinking=${i.thinkingTokens ?? '?'} answer=${i.answerTokens ?? '?'} prompt=${i.promptTokens ?? '?'} ms=${i.ms} firstChunkMs=${i.firstChunkMs ?? '-'} chars=${i.chars}`

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      }
    )
    if (res.status === 429 || res.status >= 500) {
      console.error(`[beatie] gemini ${label}: HTTP ${res.status}`)
      return { ok: false, reason: 'busy', detail: `HTTP ${res.status}`, info: info() }
    }
    if (!res.ok || !res.body) {
      const detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      console.error(`[beatie] gemini ${label}: ${detail}`)
      return { ok: false, reason: 'error', detail, info: info() }
    }

    // Server-sent events: each "data: {...}" line is a partial response.
    let buffer = ''
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const event = JSON.parse(line.slice(5))
        const candidate = event?.candidates?.[0]
        for (const part of candidate?.content?.parts ?? []) {
          // Thought summaries only arrive if asked for; skip them regardless.
          if (part?.thought || typeof part?.text !== 'string') continue
          if (firstChunkMs === null) firstChunkMs = Date.now() - started
          text += part.text
        }
        if (candidate?.finishReason) finishReason = candidate.finishReason
        if (event?.usageMetadata) usage = event.usageMetadata
        if (event?.promptFeedback?.blockReason) blockReason = event.promptFeedback.blockReason
      }
    }
  } catch (err) {
    // Timeouts and network failures: the service isn't answering in time.
    const i = info()
    console.warn(
      `[beatie] gemini ${label}: gave up after ${i.ms}ms (${(err as Error).name}): ${describe(i)} last100=${JSON.stringify(text.slice(-100))}`
    )
    return { ok: false, reason: 'busy', detail: (err as Error).message, info: i }
  }

  const i = info()
  console.log(`[beatie] gemini ${label}: ${describe(i)}`)
  text = text.trim()
  if (!text) {
    return { ok: false, reason: 'error', detail: `no text (${finishReason ?? blockReason ?? 'empty'})`, info: i }
  }
  return { ok: true, text, info: i }
}
