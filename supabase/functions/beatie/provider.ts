/**
 * The only file that knows which AI service Beatie uses.
 *
 * Everything Gemini-specific lives here: the model, the endpoint, the
 * request and response shapes, and the key's secret name. The rest of the
 * function talks to generate() and nothing else, so moving to another
 * provider means rewriting this file and setting a different secret.
 */

/** A Flash model available on the Gemini API free tier. */
export const MODEL = 'gemini-2.5-flash'

/** Supabase secret holding the key. Never sent to the browser. */
const KEY_SECRET = 'GEMINI_API_KEY'

const TIMEOUT_MS = 25_000

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

export type GenerateOptions = {
  /** Upper bound on the answer's length. */
  maxTokens: number
  /** Lower is steadier; translation wants it low. */
  temperature: number
  /** Ask for a JSON response (used for translations). */
  json?: boolean
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
      maxOutputTokens: options.maxTokens,
      // Flash "thinks" by default, and thinking tokens come out of the same
      // budget and the same free-tier quota. Beatie's answers are short and
      // don't need it.
      thinkingConfig: { thinkingBudget: 0 },
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
    },
  }

  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
