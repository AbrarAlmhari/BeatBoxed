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
}

/**
 * busy:  the provider is down, overloaded or rate limiting us — worth
 *        trying again in a minute.
 * error: anything else (blocked answer, empty answer, bad config).
 */
export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'busy' | 'error'; detail: string }

export async function generate(
  systemPrompt: string,
  messages: ChatMessage[],
  options: GenerateOptions
): Promise<GenerateResult> {
  const key = Deno.env.get(KEY_SECRET)
  if (!key) return { ok: false, reason: 'error', detail: `${KEY_SECRET} is not set` }

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

  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${currentModel()}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      }
    )
  } catch (err) {
    // Timeouts and network failures: the service isn't answering.
    return { ok: false, reason: 'busy', detail: (err as Error).message }
  }

  if (res.status === 429 || res.status >= 500) {
    return { ok: false, reason: 'busy', detail: `HTTP ${res.status}` }
  }
  if (!res.ok) {
    return { ok: false, reason: 'error', detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
  }

  const data = await res.json().catch(() => null)
  const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) {
    const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'empty'
    return { ok: false, reason: 'error', detail: `no text (${why})` }
  }
  return { ok: true, text }
}
