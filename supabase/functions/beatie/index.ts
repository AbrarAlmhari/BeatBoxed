import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { generate, type ChatMessage } from './provider.ts'
import {
  EXPLAIN_REQUEST,
  LANGUAGE_NAMES,
  STRICTER,
  explainLineRequest,
  isLyricLine,
  lineKey,
  lyricLines,
  quotedLyricLines,
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
 *   limit   this user's 30 requests for today are used up
 *   global  the whole app's 150 Gemini calls for today are used up
 *   busy    Gemini is down, overloaded or rate limiting
 *   error   anything else
 * Only a missing or invalid login is a 401.
 */

/** Per user per day. Cache hits don't count. */
const USER_DAILY_LIMIT = 30
/** Gemini calls per day for the whole app, retries included. */
const GLOBAL_DAILY_LIMIT = 150

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

type Code = 'limit' | 'global' | 'busy' | 'error' | 'bad_request'
const fail = (code: Code, status = 200) => json({ ok: false, code }, status)

type Ctx = {
  songId: string
  song: SongInfo
  language: string
  lyrics: string[]
  /** 'failed' means the lookup errored, so "no lyrics" can't be trusted. */
  lyricsStatus: 'found' | 'none' | 'failed'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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
    const ctx = await loadContext(songId, userId, auth)
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

async function loadContext(songId: string, userId: string, auth: string): Promise<Ctx | null> {
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

  return { songId, song, language, lyrics, lyricsStatus }
}

/* --------------------------------------------------------------- cache */

type CacheKind = 'explain' | 'line' | 'translate'

async function readCache(ctx: Ctx, kind: CacheKind, key = '') {
  const { data } = await admin
    .from('beatie_cache')
    .select('content, has_lyrics')
    .eq('song_id', ctx.songId)
    .eq('kind', kind)
    .eq('line_key', key)
    .eq('language', ctx.language)
    .maybeSingle()
  return data as { content: string; has_lyrics: boolean } | null
}

async function writeCache(ctx: Ctx, kind: CacheKind, content: string, key = '') {
  // An answer written while the lyrics lookup was failing would claim the
  // song has no lyrics, for everyone, for good. Serve it, don't keep it.
  if (ctx.lyricsStatus === 'failed') return
  const { error } = await admin.from('beatie_cache').upsert(
    {
      song_id: ctx.songId,
      kind,
      line_key: key,
      language: ctx.language,
      content,
      has_lyrics: ctx.lyricsStatus === 'found',
    },
    // Someone else may have filled it a moment ago; theirs is just as good.
    { onConflict: 'song_id,kind,line_key,language', ignoreDuplicates: true }
  )
  if (error) console.error('[beatie] cache write failed', error)
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
 * Asks the provider for a prose answer and checks it doesn't reprint the
 * lyrics. One retry with a stricter reminder, then give up — never more.
 */
async function proseAnswer(
  ctx: Ctx,
  userId: string,
  messages: ChatMessage[],
  opts: { maxTokens: number; allowedLine?: string; maxQuoted: number }
): Promise<{ text: string } | { code: Code }> {
  const blocked = await takeQuota(userId)
  if (blocked) return { code: blocked }

  const system = songSystemPrompt(PERSONALITY, ctx.song, ctx.language, ctx.lyrics)
  let attempt = messages
  for (let tries = 0; tries < 2; tries++) {
    const res = await generate(system, attempt, { maxTokens: opts.maxTokens, temperature: 0.7 })
    if (!res.ok) {
      console.error('[beatie] provider', res.reason, res.detail)
      return { code: res.reason }
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
      // The retry is a real Gemini call, so it counts against the app's cap.
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
  const cached = await readCache(ctx, 'explain')
  if (cached) return ok(ctx, { text: cached.content, hasLyrics: cached.has_lyrics, cached: true })

  const answer = await proseAnswer(ctx, userId, [{ role: 'user', text: EXPLAIN_REQUEST }], {
    maxTokens: 700,
    maxQuoted: 1,
  })
  if ('code' in answer) return fail(answer.code)
  await writeCache(ctx, 'explain', answer.text)
  return ok(ctx, { text: answer.text, hasLyrics: ctx.lyricsStatus === 'found', cached: false })
}

async function explainLine(ctx: Ctx, userId: string, line: unknown) {
  // Only real lines of this song: otherwise this would explain (and cache)
  // any text anyone sends.
  if (typeof line !== 'string' || !isLyricLine(line, ctx.lyrics)) return fail('bad_request')
  const key = await lineKey(line)

  const cached = await readCache(ctx, 'line', key)
  if (cached) return ok(ctx, { text: cached.content, hasLyrics: true, cached: true })

  const answer = await proseAnswer(ctx, userId, [{ role: 'user', text: explainLineRequest(line) }], {
    maxTokens: 350,
    allowedLine: line,
    maxQuoted: 0,
  })
  if ('code' in answer) return fail(answer.code)
  await writeCache(ctx, 'line', answer.text, key)
  return ok(ctx, { text: answer.text, hasLyrics: true, cached: false })
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

  const answer = await proseAnswer(ctx, userId, messages, { maxTokens: 400, maxQuoted: 1 })
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

  const cached = await readCache(ctx, 'translate')
  if (cached) {
    const lines = parseLines(cached.content, ctx.lyrics.length)
    // A cached translation that no longer lines up (lrclib's lyrics changed)
    // is stale: fall through and make a new one.
    if (lines) return ok(ctx, { lines, hasLyrics: true, cached: true })
  }

  const blocked = await takeQuota(userId)
  if (blocked) return fail(blocked)

  const system = translationSystemPrompt(ctx.language, ctx.lyrics.length)
  const input: ChatMessage[] = [{ role: 'user', text: JSON.stringify(ctx.lyrics) }]
  const maxTokens = Math.min(8192, 200 + ctx.lyrics.join(' ').length * 2)

  for (let tries = 0; tries < 2; tries++) {
    if (tries === 1) {
      const capped = await takeQuota(null)
      if (capped) return fail(capped)
    }
    const res = await generate(system, input, { maxTokens, temperature: 0.2, json: true })
    if (!res.ok) {
      console.error('[beatie] provider', res.reason, res.detail)
      return fail(res.reason)
    }
    const lines = parseLines(res.text, ctx.lyrics.length)
    if (lines) {
      if (cached) {
        // Replace the stale row rather than leave two disagreeing.
        await admin
          .from('beatie_cache')
          .delete()
          .eq('song_id', ctx.songId)
          .eq('kind', 'translate')
          .eq('line_key', '')
          .eq('language', ctx.language)
      }
      await writeCache(ctx, 'translate', JSON.stringify(lines))
      return ok(ctx, { lines, hasLyrics: true, cached: false })
    }
    console.error(`[beatie] translation line count off (try ${tries + 1})`)
  }
  return fail('error')
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
