import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  currentModel,
  fallbackModel,
  generate,
  wasCutOff,
  type ChatMessage,
  type GenerateOptions,
  type GenerateResult,
} from './groq.ts'
import {
  EXPLAIN_REQUEST,
  LANGUAGE_NAMES,
  STRICTER,
  explainLineRequest,
  isLyricLine,
  lineKey,
  lyricLines,
  quotedLyricLines,
  repetitionProblem,
  songSystemPrompt,
  translationSystemPrompt,
  type SongInfo,
} from './prompts.ts'

/**
 * Beatie, the music buddy on the Song page and in Home's Ask Beatie sheet.
 *
 *   POST { action: 'explain',   songId }
 *   POST { action: 'line',      songId, line }
 *   POST { action: 'translate', songId }
 *   POST { action: 'chat',      songId, messages: [{ role, text }, ...] }
 *
 * Every answer is written in the user's language from Settings
 * (profiles.translation_language, English when empty). Explanations, line
 * explanations and translations are cached in beatie_cache per song and
 * language and served to everyone from there; chat is never cached.
 *
 * Replies are always 200 with { ok: true, ... } or { ok: false, code }, so
 * the app can show a friendly message for each code and never a raw error:
 *   limit    this user's 30 requests for today are used up
 *   global   the whole app's 150 AI calls for today are used up
 *   busy     the AI service is down, overloaded, rate limiting or too slow
 *   pending  still being written in the background; ask again shortly
 *   error    anything else
 * Only a missing or invalid login is a 401.
 */

/** Per user per day. Cache hits don't count. */
const USER_DAILY_LIMIT = 30
/** AI calls per day for the whole app, retries and backups included. */
const GLOBAL_DAILY_LIMIT = 150

/**
 * How long a request may run, measured from the moment it arrives (before
 * the song and lyrics are loaded), all its AI calls together. Explanations,
 * line explanations and translations are cached and, past
 * RESPOND_WITHIN_MS, finish in the background while the user sees "check
 * back", so they get up to 120 seconds in total: well inside Supabase's
 * 150-second limit for a function, however long the lookups before the
 * first call took. Chat isn't cached and the user is waiting on it, so it
 * gets 40.
 */
const REQUEST_BUDGET_MS = 120_000
const CHAT_BUDGET_MS = 40_000

/**
 * The lyric-quote retry, and the backup model when the primary is busy,
 * only start if at least this much budget is left.
 */
const MIN_RETRY_MS = 20_000

/**
 * A cacheable answer not ready by now is left to finish in the background:
 * the app hears 'pending', and the answer lands in the cache for the next tap.
 */
const RESPOND_WITHIN_MS = 25_000

/**
 * An empty (in-progress) cache row older than this means its background work
 * died (the function was stopped); it's cleared and the work starts again.
 */
const PENDING_STALE_MS = 3 * 60_000

/**
 * After a job fails (the AI service down, too slow, or an answer rejected), its row
 * holds FAILED for this long, and taps meanwhile get 'busy' ("taking a
 * break") without calling the AI service again. Then the next tap tries afresh.
 */
const FAILED_HOLD_MS = 2 * 60_000
const FAILED = '__beatie_failed__'

const MAX_HISTORY = 10
const MAX_QUESTION_CHARS = 500
const MAX_MESSAGE_CHARS = 1000

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

// Kept in its own file so the team can edit Beatie's voice without touching
// code. Shipped alongside the function via supabase/config.toml.
const PERSONALITY = await Deno.readTextFile(new URL('./personality.md', import.meta.url))

type Code = 'limit' | 'global' | 'busy' | 'pending' | 'error' | 'bad_request'

// Supabase's runtime global for finishing work after the reply is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined
const fail = (code: Code, status = 200) => json({ ok: false, code }, status)

type Ctx = {
  /** When the request arrived: every budget is measured from here. */
  startedAt: number
  songId: string
  song: SongInfo
  language: string
  lyrics: string[]
  /** 'failed' means the lookup errored, so "no lyrics" can't be trusted. */
  lyricsStatus: 'found' | 'none' | 'failed'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const startedAt = Date.now()

  try {
    // 1. Signed in?
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const { data: who } = token ? await admin.auth.getUser(token) : { data: null }
    const userId = who?.user?.id
    if (!userId) return json({ ok: false, code: 'auth' }, 401)

    const body = await req.json().catch(() => null)
    const action = body?.action
    const songId = typeof body?.songId === 'string' ? body.songId : null
    if (!songId || !['explain', 'line', 'translate', 'chat'].includes(action)) {
      return fail('bad_request')
    }

    // 2. The song, the user's language, and the lyrics (fetched here, so the
    //    browser never sends lyrics in).
    const ctx = await loadContext(songId, userId, auth, startedAt)
    if (!ctx) return fail('bad_request')

    if (action === 'explain') return await explain(ctx, userId)
    if (action === 'line') return await explainLine(ctx, userId, body?.line)
    if (action === 'translate') return await translate(ctx, userId)
    return await chat(ctx, userId, body?.messages)
  } catch (err) {
    console.error('[beatie]', err)
    return fail('error')
  }
})

/* ------------------------------------------------------------- context */

async function loadContext(
  songId: string,
  userId: string,
  auth: string,
  startedAt: number
): Promise<Ctx | null> {
  const [songRes, profileRes] = await Promise.all([
    admin
      .from('songs')
      .select('id, title, artists(name), albums(title, release_date)')
      .eq('id', songId)
      .maybeSingle(),
    admin.from('profiles').select('translation_language').eq('id', userId).maybeSingle(),
  ])
  if (songRes.error || !songRes.data) return null

  const row = songRes.data as unknown as {
    title: string
    artists: { name: string } | { name: string }[] | null
    albums: { title: string | null; release_date: string | null } | { title: string | null; release_date: string | null }[] | null
  }
  const artist = Array.isArray(row.artists) ? row.artists[0] : row.artists
  const album = Array.isArray(row.albums) ? row.albums[0] : row.albums
  const song: SongInfo = {
    title: row.title,
    artist: artist?.name ?? 'Unknown artist',
    album: album?.title ?? null,
    releaseYear: album?.release_date?.slice(0, 4) ?? null,
  }

  const chosen = profileRes.data?.translation_language
  const language = chosen && chosen in LANGUAGE_NAMES ? chosen : 'en'

  // Through the existing lyrics-lookup function, asked exactly the way the
  // Song page asks it (artist and title), so both see the same lines.
  let lyrics: string[] = []
  let lyricsStatus: Ctx['lyricsStatus'] = 'none'
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lyrics-lookup`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ artist: song.artist, track: song.title }),
    })
    const data = await res.json()
    if (!res.ok || data?.error) {
      lyricsStatus = 'failed'
    } else {
      lyrics = lyricLines(data)
      lyricsStatus = lyrics.length ? 'found' : 'none'
    }
  } catch (err) {
    console.error('[beatie] lyrics lookup failed', err)
    lyricsStatus = 'failed'
  }

  return { startedAt, songId, song, language, lyrics, lyricsStatus }
}

/* --------------------------------------------------------------- cache */

type CacheKind = 'explain' | 'line' | 'translate'

/**
 * A row with empty content is a claim: someone's answer is being written
 * right now. The table's unique key means only one request can make the
 * claim, so a song's answer is asked of the AI service once, however many people
 * (or taps) arrive while it's being written. The claim is filled in with the
 * answer, or removed if writing it fails.
 */
type CacheRow = { content: string; has_lyrics: boolean; created_at: string }

function cacheKey(ctx: Ctx, kind: CacheKind, key: string) {
  return { song_id: ctx.songId, kind, line_key: key, language: ctx.language }
}

async function readCache(ctx: Ctx, kind: CacheKind, key = ''): Promise<CacheRow | null> {
  const { data } = await admin
    .from('beatie_cache')
    .select('content, has_lyrics, created_at')
    .match(cacheKey(ctx, kind, key))
    .maybeSingle()
  return data as CacheRow | null
}

/** True if this request made the claim; false if someone else holds it. */
async function claimCache(ctx: Ctx, kind: CacheKind, key: string) {
  const { data, error } = await admin
    .from('beatie_cache')
    .upsert(
      { ...cacheKey(ctx, kind, key), content: '', has_lyrics: ctx.lyricsStatus === 'found' },
      { onConflict: 'song_id,kind,line_key,language', ignoreDuplicates: true }
    )
    .select('id')
  if (error) {
    console.error('[beatie] cache claim failed', error)
    return false
  }
  return (data ?? []).length > 0
}

async function fillCache(ctx: Ctx, kind: CacheKind, key: string, content: string) {
  const { error } = await admin
    .from('beatie_cache')
    .update({ content, created_at: new Date().toISOString() })
    .match(cacheKey(ctx, kind, key))
    .eq('content', '')
  if (error) console.error('[beatie] cache write failed', error)
}

/** Turns a claim into a failure marker, held for FAILED_HOLD_MS. */
async function markFailed(ctx: Ctx, kind: CacheKind, key: string) {
  const { error } = await admin
    .from('beatie_cache')
    .update({ content: FAILED, created_at: new Date().toISOString() })
    .match(cacheKey(ctx, kind, key))
    .eq('content', '')
  if (error) console.error('[beatie] cache failure mark failed', error)
}

/** Removes a claim or a stale answer, so the next request starts fresh. */
async function clearCache(ctx: Ctx, kind: CacheKind, key: string, onlyClaim: boolean) {
  let q = admin.from('beatie_cache').delete().match(cacheKey(ctx, kind, key))
  if (onlyClaim) q = q.eq('content', '')
  const { error } = await q
  if (error) console.error('[beatie] cache clear failed', error)
}

type Work = { content: string } | { code: Code }

/**
 * The cache-first flow shared by explain, line and translate:
 *
 *   1. A ready answer is served from the cache, free.
 *   2. Someone else's answer still being written: 'pending', free.
 *   3. One that failed in the last FAILED_HOLD_MS: 'busy', free.
 *   4. Otherwise claim it, and run `work` (which takes the quota and calls
 *      the AI service). If it's done within RESPOND_WITHIN_MS, reply with it. If
 *      not, reply 'pending' and let it finish in the background: the answer
 *      lands in the cache and the next tap gets it. Either way the work, and
 *      its quota, happens once.
 *
 * With the lyrics lookup failing, nothing is cached (an answer would claim
 * the song has no lyrics, for everyone, for good), so the work just runs.
 */
async function cachedAnswer(
  ctx: Ctx,
  kind: CacheKind,
  key: string,
  work: () => Promise<Work>,
  reply: (content: string, hasLyrics: boolean, cached: boolean) => Response,
  usable: (content: string) => boolean = () => true
): Promise<Response> {
  const hasLyrics = ctx.lyricsStatus === 'found'
  if (ctx.lyricsStatus === 'failed') {
    const r = await work()
    return 'code' in r ? fail(r.code) : reply(r.content, hasLyrics, false)
  }

  const row = await readCache(ctx, kind, key)
  if (row) {
    const age = Date.now() - new Date(row.created_at).getTime()
    if (row.content === FAILED) {
      if (age < FAILED_HOLD_MS) return fail('busy')
    } else if (row.content !== '' && usable(row.content)) {
      return reply(row.content, row.has_lyrics, true)
    }
    if (row.content === '' && age < PENDING_STALE_MS) return fail('pending')
    // A dead claim, or an answer that no longer fits (e.g. a translation
    // whose line count no longer matches the lyrics): start over.
    await clearCache(ctx, kind, key, false)
  }

  if (!(await claimCache(ctx, kind, key))) return fail('pending')

  // Quota refusals are about this user (or today's total), not the song, so
  // they just release the claim; real failures hold it for FAILED_HOLD_MS.
  const job: Promise<Work> = work()
    .then(async (r) => {
      if (!('code' in r)) await fillCache(ctx, kind, key, r.content)
      else if (r.code === 'busy' || r.code === 'error') await markFailed(ctx, kind, key)
      else await clearCache(ctx, kind, key, true)
      return r
    })
    .catch(async (err) => {
      console.error('[beatie] background work failed', err)
      await markFailed(ctx, kind, key)
      return { code: 'error' as Code }
    })

  const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), RESPOND_WITHIN_MS))
  const done = await Promise.race([job, timer])
  if (done === null) {
    console.log(`[beatie] ${kind} not ready after ${RESPOND_WITHIN_MS / 1000}s; finishing in the background`)
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job)
    return fail('pending')
  }
  return 'code' in done ? fail(done.code) : reply(done.content, hasLyrics, false)
}

/* --------------------------------------------------------------- quota */

/** One request from this user (user null: a retry, global cap only). */
async function takeQuota(userId: string | null): Promise<Code | null> {
  const { data, error } = await admin.rpc('beatie_take_quota', {
    p_user: userId,
    p_user_limit: USER_DAILY_LIMIT,
    p_global_limit: GLOBAL_DAILY_LIMIT,
  })
  if (error) {
    console.error('[beatie] quota check failed', error)
    return 'error'
  }
  if (data === 'user_limit') return 'limit'
  if (data === 'global_limit') return 'global'
  return null
}

/**
 * One call to the primary model, and when it's busy (down, overloaded,
 * rate limiting or too slow) one call to the backup model, if at least
 * MIN_RETRY_MS of the budget is left. The backup is a real extra call, so
 * it takes from today's app-wide cap first, as the retries do.
 */
async function generateWithBackup(
  system: string,
  messages: ChatMessage[],
  options: GenerateOptions,
  deadline: number
): Promise<GenerateResult | { ok: false; reason: Code; detail: string }> {
  const first = await generate(system, messages, options)
  if (first.ok || first.reason !== 'busy') return first
  const backup = fallbackModel()
  if (backup === currentModel()) return first
  if (deadline - Date.now() < MIN_RETRY_MS) {
    console.warn(`[beatie] no time left for the backup model (${options.label ?? 'call'})`)
    return first
  }
  const capped = await takeQuota(null)
  if (capped) return { ok: false, reason: capped, detail: 'quota' }
  console.warn(`[beatie] primary model busy; trying ${backup} (${options.label ?? 'call'})`)
  return generate(system, messages, {
    ...options,
    model: backup,
    timeoutMs: deadline - Date.now(),
    label: `${options.label ?? 'call'} backup`,
  })
}

/**
 * Asks the provider for a prose answer and checks it doesn't reprint the
 * lyrics. One retry with a stricter reminder, then give up — never more.
 */
async function proseAnswer(
  ctx: Ctx,
  userId: string,
  messages: ChatMessage[],
  opts: { maxTokens: number; budgetMs: number; label: string; allowedLine?: string; maxQuoted: number }
): Promise<{ text: string } | { code: Code }> {
  const blocked = await takeQuota(userId)
  if (blocked) return { code: blocked }

  const deadline = ctx.startedAt + opts.budgetMs
  const system = songSystemPrompt(PERSONALITY, ctx.song, ctx.language, ctx.lyrics)
  let attempt = messages
  for (let tries = 0; tries < 2; tries++) {
    const res = await generateWithBackup(
      system,
      attempt,
      {
        maxTokens: opts.maxTokens,
        temperature: 0.7,
        timeoutMs: deadline - Date.now(),
        label: `${opts.label} try ${tries + 1}`,
      },
      deadline
    )
    if (!res.ok) {
      console.error('[beatie] provider', res.reason, res.detail)
      return { code: res.reason }
    }
    // A cut-off or looping answer isn't worth a retry: the next one would
    // likely do the same. Logged, then the user sees "taking a break".
    if (wasCutOff(res.info)) {
      console.warn(`[beatie] answer rejected (${opts.label}): cut off at the token limit`)
      return { code: 'error' }
    }
    const loop = repetitionProblem(res.text)
    if (loop) {
      console.warn(`[beatie] answer rejected (${opts.label}): ${loop}`)
      return { code: 'error' }
    }
    const quoted = quotedLyricLines(res.text, ctx.lyrics, ctx.song.title, opts.allowedLine)
    if (quoted.length <= opts.maxQuoted) {
      return { text: res.text }
    }
    // Line numbers only, never the lyrics: enough to tell a real quote from
    // a false alarm by checking the song's lyrics.
    console.warn(
      `[beatie] answer rejected (try ${tries + 1}): quoted lyric lines ${quoted.join(', ')} of ${ctx.lyrics.length}`
    )
    if (tries === 0) {
      if (deadline - Date.now() < MIN_RETRY_MS) {
        console.warn(`[beatie] no time left for the lyric-quote retry (${opts.label})`)
        break
      }
      // The retry is a real AI call, so it counts against the app's cap.
      const capped = await takeQuota(null)
      if (capped) return { code: capped }
      const last = attempt[attempt.length - 1]
      attempt = [...attempt.slice(0, -1), { role: 'user', text: `${last.text}\n\n${STRICTER}` }]
    }
  }
  console.error('[beatie] answer quoted too much of the lyrics twice; not shown')
  return { code: 'error' }
}

/* ------------------------------------------------------------- actions */

async function explain(ctx: Ctx, userId: string) {
  return cachedAnswer(
    ctx,
    'explain',
    '',
    async () => {
      const a = await proseAnswer(ctx, userId, [{ role: 'user', text: EXPLAIN_REQUEST }], {
        maxTokens: 700,
        budgetMs: REQUEST_BUDGET_MS,
        label: `explain ${ctx.songId.slice(0, 8)} ${ctx.language}`,
        maxQuoted: 1,
      })
      return 'code' in a ? a : { content: a.text }
    },
    (content, hasLyrics, cached) => ok(ctx, { text: content, hasLyrics, cached })
  )
}

async function explainLine(ctx: Ctx, userId: string, line: unknown) {
  // Only real lines of this song: otherwise this would explain (and cache)
  // any text anyone sends.
  if (typeof line !== 'string' || !isLyricLine(line, ctx.lyrics)) return fail('bad_request')
  const key = await lineKey(line)
  return cachedAnswer(
    ctx,
    'line',
    key,
    async () => {
      const a = await proseAnswer(ctx, userId, [{ role: 'user', text: explainLineRequest(line) }], {
        maxTokens: 350,
        budgetMs: REQUEST_BUDGET_MS,
        label: `line ${ctx.songId.slice(0, 8)} ${ctx.language}`,
        allowedLine: line,
        maxQuoted: 0,
      })
      return 'code' in a ? a : { content: a.text }
    },
    (content, _hasLyrics, cached) => ok(ctx, { text: content, hasLyrics: true, cached })
  )
}

async function chat(ctx: Ctx, userId: string, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return fail('bad_request')
  const messages: ChatMessage[] = raw
    .slice(-MAX_HISTORY)
    .filter(
      (m): m is ChatMessage =>
        (m?.role === 'user' || m?.role === 'assistant') && typeof m?.text === 'string' && m.text.trim() !== ''
    )
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, MAX_MESSAGE_CHARS) }))
  // The provider wants the conversation to open with the user.
  while (messages.length && messages[0].role !== 'user') messages.shift()
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || last.text.length > MAX_QUESTION_CHARS) return fail('bad_request')

  const answer = await proseAnswer(ctx, userId, messages, {
    maxTokens: 400,
    budgetMs: CHAT_BUDGET_MS,
    label: `chat ${ctx.songId.slice(0, 8)} ${ctx.language}`,
    maxQuoted: 1,
  })
  if ('code' in answer) return fail(answer.code)
  return ok(ctx, { text: answer.text, hasLyrics: ctx.lyricsStatus === 'found', cached: false })
}

/**
 * The whole song in one request: a JSON array with exactly one translated
 * line per original. One retry if the count is off, then give up. No
 * lyric-quoting check here — a translation is meant to cover every line,
 * and it's shown only on the Song page, under the lyrics it translates.
 */
async function translate(ctx: Ctx, userId: string) {
  if (ctx.lyricsStatus !== 'found') return fail(ctx.lyricsStatus === 'failed' ? 'busy' : 'bad_request')
  const count = ctx.lyrics.length

  return cachedAnswer(
    ctx,
    'translate',
    '',
    async () => {
      const blocked = await takeQuota(userId)
      if (blocked) return { code: blocked }

      const deadline = ctx.startedAt + REQUEST_BUDGET_MS
      const system = translationSystemPrompt(ctx.language, count)
      const input: ChatMessage[] = [{ role: 'user', text: JSON.stringify(ctx.lyrics) }]
      const maxTokens = Math.min(8192, 200 + ctx.lyrics.join(' ').length * 2)

      for (let tries = 0; tries < 2; tries++) {
        if (tries === 1) {
          if (deadline - Date.now() < MIN_RETRY_MS) {
            console.warn('[beatie] no time left for the translation retry')
            break
          }
          const capped = await takeQuota(null)
          if (capped) return { code: capped }
        }
        const res = await generateWithBackup(
          system,
          input,
          {
            maxTokens,
            temperature: 0.2,
            json: true,
            timeoutMs: deadline - Date.now(),
            label: `translate ${ctx.songId.slice(0, 8)} ${ctx.language} try ${tries + 1}`,
          },
          deadline
        )
        if (!res.ok) {
          console.error('[beatie] provider', res.reason, res.detail)
          return { code: res.reason }
        }
        if (wasCutOff(res.info)) {
          console.warn('[beatie] translation rejected: cut off at the token limit')
          return { code: 'error' }
        }
        const lines = parseLines(res.text, count)
        if (lines) return { content: JSON.stringify(lines) }
        console.error(`[beatie] translation line count off (try ${tries + 1})`)
      }
      return { code: 'error' }
    },
    (content, _hasLyrics, cached) =>
      ok(ctx, { lines: parseLines(content, count) ?? [], hasLyrics: true, cached }),
    // A cached translation that no longer lines up with the lyrics (lrclib
    // changed them) is stale and gets made again.
    (content) => parseLines(content, count) !== null
  )
}

/** A JSON array of exactly `count` strings, or null. */
function parseLines(text: string, count: number): string[] | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '')
    const value = JSON.parse(cleaned)
    if (Array.isArray(value) && value.length === count && value.every((v) => typeof v === 'string')) {
      return value.map((v) => v.trim())
    }
  } catch {
    // fall through
  }
  return null
}

function ok(
  ctx: Ctx,
  payload: { text?: string; lines?: string[]; hasLyrics: boolean; cached: boolean }
) {
  return json({ ok: true, language: ctx.language, ...payload })
}
