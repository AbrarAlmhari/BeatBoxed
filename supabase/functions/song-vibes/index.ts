/**
 * Labels songs for the daily check-in: the lyrics' mood and the beat's
 * energy, with a confidence. Background work only; nothing here is shown
 * to users as Beatie.
 *
 * Called every 10 minutes by the song-vibes-label cron job (0048), which
 * sends a private secret kept in the database's Vault. Without that exact
 * secret the function does nothing, so the public key alone can't start a
 * run. Each run labels at most BATCH songs, and the database stops handing
 * out songs at DAILY_CAP calls a day. Calls that fail are given back
 * (release_song_vibes, 0051), so only songs actually labelled use it up.
 *
 * Anything that goes wrong saves nothing; the song stays in the queue.
 *   - The AI service busy (a 429, overloaded, or too slow): the run stops
 *     there. That song and the ones not yet tried go back in the queue for
 *     the next run, without counting as an attempt; hammering a rate limit
 *     only makes it longer.
 *   - Any other failure (a reply that isn't the exact JSON asked for, a
 *     save that fails): the next song is tried. The failed song keeps its
 *     attempt and back-off (claim_song_vibes sets when it's tried again),
 *     so a song that never works gives up after 5 tries.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { currentModel, generate, lastRateLimits } from '../beatie/groq.ts'
import {
  VIBES_BATCH as BATCH,
  VIBES_DAILY_CAP as DAILY_CAP,
  VIBES_DEFAULT_MODEL as DEFAULT_MODEL,
  VIBES_LYRICS_CHARS as LYRICS_CHARS,
  VIBES_LYRICS_TIMEOUT_MS,
  VIBES_MAX_TOKENS,
  VIBES_TIMEOUT_MS,
} from '../_shared/config.ts'

/**
 * The labeller's own Groq model, separate from Beatie's GROQ_MODEL. Read
 * per run, so `supabase secrets set` changes it with no redeploy. There's
 * no backup model: a busy call just leaves the song in the queue. The
 * default, used when the secret isn't set, is in _shared/config.ts.
 */
const MODEL_SECRET = 'VIBES_GROQ_MODEL'
const vibesModel = () => currentModel(Deno.env.get(MODEL_SECRET) || DEFAULT_MODEL)
/** Without lyrics (and not instrumental) a mood is a guess from the title. */
const NO_LYRICS_MAX_CONFIDENCE = 0.5

const MOODS = ['sad', 'happy', 'nostalgic', 'romantic', 'angry', 'none'] as const
const ENERGIES = ['low', 'mid', 'high'] as const

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

type Claimed = {
  song_id: string
  title: string
  artist_name: string | null
  duration_ms: number | null
  genre_group: string | null
}

type Label = { lyrics_mood: (typeof MOODS)[number]; energy: (typeof ENERGIES)[number]; confidence: number }

const SYSTEM = `You label songs for a music app's mood picker.
Reply with JSON only, exactly this shape and nothing else:
{"lyrics_mood": "sad" | "happy" | "nostalgic" | "romantic" | "angry" | "none", "energy": "low" | "mid" | "high", "confidence": number between 0 and 1}
lyrics_mood: the main feeling of the lyrics. Use "none" for instrumental songs.
energy: the beat. "low" is slow and soft, "mid" is in between, "high" is upbeat.
confidence: how sure you are of both labels together. Be honest; say less than 0.6 when you are guessing.`

/** The lyrics from lrclib, asked the way lyrics-lookup asks. */
async function lyricsFor(song: Claimed): Promise<{ kind: 'found' | 'instrumental' | 'none'; text: string }> {
  if (!song.artist_name) return { kind: 'none', text: '' }
  const params = new URLSearchParams({ artist_name: song.artist_name, track_name: song.title })
  if (song.duration_ms) params.set('duration', String(Math.round(song.duration_ms / 1000)))
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': 'Beatboxed/0.1 (CSC 305 class project)' },
      signal: AbortSignal.timeout(VIBES_LYRICS_TIMEOUT_MS),
    })
    if (!res.ok) return { kind: 'none', text: '' }
    const data = await res.json()
    if (data.instrumental) return { kind: 'instrumental', text: '' }
    const plain = typeof data.plainLyrics === 'string' ? data.plainLyrics.trim() : ''
    return plain ? { kind: 'found', text: plain.slice(0, LYRICS_CHARS) } : { kind: 'none', text: '' }
  } catch {
    return { kind: 'none', text: '' }
  }
}

/** Strict: exactly the three keys, values from the lists, a number in 0–1. */
function parseLabel(text: string): Label | null {
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
  if (typeof lyrics_mood !== 'string' || !(MOODS as readonly string[]).includes(lyrics_mood)) return null
  if (typeof energy !== 'string' || !(ENERGIES as readonly string[]).includes(energy)) return null
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  return { lyrics_mood: lyrics_mood as Label['lyrics_mood'], energy: energy as Label['energy'], confidence }
}

type Outcome = 'labelled' | 'busy' | 'failed' | 'invalid'

/** Tokens a run used, for sizing the daily cap; reported in the run's summary. */
type Tokens = { calls: number; prompt: number; thinking: number; answer: number }

async function labelOne(song: Claimed, tokens: Tokens): Promise<Outcome> {
  const lyrics = await lyricsFor(song)
  const prompt = [
    `Title: ${song.title}`,
    `Artist: ${song.artist_name ?? 'unknown'}`,
    `Genre group: ${song.genre_group ?? 'unknown'}`,
    `Lyrics: ${lyrics.kind === 'found' ? `\n${lyrics.text}` : lyrics.kind === 'instrumental' ? 'INSTRUMENTAL' : 'NOT FOUND'}`,
  ].join('\n')

  const model = vibesModel()
  const result = await generate(SYSTEM, [{ role: 'user', text: prompt }], {
    model,
    maxTokens: VIBES_MAX_TOKENS,
    temperature: 0.2,
    json: true,
    timeoutMs: VIBES_TIMEOUT_MS,
    label: `vibe ${song.song_id.slice(0, 8)}`,
  })
  if (result.info) {
    tokens.calls += 1
    tokens.prompt += result.info.promptTokens ?? 0
    tokens.thinking += result.info.thinkingTokens ?? 0
    tokens.answer += result.info.answerTokens ?? 0
  }
  if (!result.ok) {
    await fail(song.song_id, `${result.reason}: ${result.detail ?? ''}`.slice(0, 300))
    return result.reason === 'busy' ? 'busy' : 'failed'
  }
  const label = parseLabel(result.text)
  if (!label) {
    await fail(song.song_id, `invalid reply: ${result.text.slice(0, 200)}`)
    return 'invalid'
  }
  // A mood guessed without lyrics can't be trusted for picks.
  const confidence =
    lyrics.kind === 'none' ? Math.min(label.confidence, NO_LYRICS_MAX_CONFIDENCE) : label.confidence

  const { error } = await admin.from('song_vibes').upsert({
    song_id: song.song_id,
    lyrics_mood: label.lyrics_mood,
    energy: label.energy,
    confidence,
    has_lyrics: lyrics.kind !== 'none',
    model: `groq/${model}`,
    labelled_at: new Date().toISOString(),
  })
  if (error) {
    await fail(song.song_id, `save failed: ${error.message}`)
    return 'failed'
  }
  await admin.from('song_vibe_queue').delete().eq('song_id', song.song_id)
  return 'labelled'
}

async function fail(songId: string, reason: string) {
  await admin.from('song_vibe_queue').update({ last_error: reason }).eq('song_id', songId)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Not found', { status: 404 })

  // The cron job's secret, checked by the database. Anything else: refused.
  const candidate = req.headers.get('x-cron-secret') ?? ''
  const { data: ok, error: secretError } = await admin.rpc('song_vibes_secret_ok', { candidate })
  if (secretError || ok !== true) return new Response('Forbidden', { status: 403 })

  const { data, error } = await admin.rpc('claim_song_vibes', { batch_size: BATCH, daily_cap: DAILY_CAP })
  if (error) {
    console.error('[song-vibes] claim failed:', error.message)
    return Response.json({ error: 'claim failed' }, { status: 500 })
  }
  const songs = (data ?? []) as Claimed[]
  const outcomes: Record<string, number> = {}
  /** Tried and failed: the call is given back, the attempt stays. */
  const failed: string[] = []
  /** Busy, or never tried because the run stopped: back in the queue as if untouched. */
  let requeue: string[] = []
  const tokens: Tokens = { calls: 0, prompt: 0, thinking: 0, answer: 0 }
  // One at a time: gentle on Groq's rate limits and on lrclib.
  for (const [i, song] of songs.entries()) {
    const outcome = await labelOne(song, tokens).catch(async (err): Promise<Outcome> => {
      await fail(song.song_id, `error: ${(err as Error).message}`.slice(0, 300))
      return 'failed'
    })
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    if (outcome === 'busy') {
      requeue = songs.slice(i).map((s) => s.song_id)
      break
    }
    if (outcome !== 'labelled') failed.push(song.song_id)
  }

  // Only labelled songs count against today's cap.
  for (const [ids, again] of [[failed, false], [requeue, true]] as const) {
    if (ids.length === 0) continue
    const { error: releaseError } = await admin.rpc('release_song_vibes', { song_ids: ids, requeue: again })
    if (releaseError) console.error('[song-vibes] release failed:', releaseError.message)
  }

  // The cron job stores this answer (net._http_response): tokens and
  // Groq's limits, for sizing DAILY_CAP.
  const summary = {
    claimed: songs.length,
    ...outcomes,
    given_back: failed.length + requeue.length,
    requeued: requeue.length,
    tokens,
    limits: lastRateLimits(),
  }
  console.log('[song-vibes]', JSON.stringify(summary))

  // Kept 30 days in song_vibe_runs (numbers only), for sizing DAILY_CAP.
  // Runs that had nothing to do aren't worth a row.
  if (songs.length > 0) {
    const limits = summary.limits
    const { error: runError } = await admin.from('song_vibe_runs').insert({
      claimed: songs.length,
      labelled: outcomes.labelled ?? 0,
      failed: outcomes.failed ?? 0,
      invalid: outcomes.invalid ?? 0,
      busy: outcomes.busy ?? 0,
      given_back: summary.given_back,
      requeued: summary.requeued,
      calls: tokens.calls,
      prompt_tokens: tokens.prompt,
      reasoning_tokens: tokens.thinking,
      answer_tokens: tokens.answer,
      requests_per_day: limits?.requestsPerDay ?? null,
      requests_left_today: limits?.requestsLeftToday ?? null,
      tokens_per_minute: limits?.tokensPerMinute ?? null,
      tokens_left_this_minute: limits?.tokensLeftThisMinute ?? null,
    })
    if (runError) console.error('[song-vibes] run log failed:', runError.message)
  }

  return Response.json(summary)
})
