/**
 * Labels songs for the daily check-in: the lyrics' mood and the beat's
 * energy, with a confidence. Background work only; nothing here is shown
 * to users as Beatie.
 *
 * Called every 10 minutes by the song-vibes-label cron job (0048), which
 * sends a private secret kept in the database's Vault. Without that exact
 * secret the function does nothing, so the public key alone can't start a
 * run. Each run labels at most BATCH songs, and the database stops handing
 * out songs at DAILY_CAP calls a day, failures included.
 *
 * Anything that goes wrong (Gemini busy or slow, a reply that isn't the
 * exact JSON asked for) saves nothing; the song stays in the queue and is
 * tried again later (claim_song_vibes sets when).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { currentModel, generate } from '../beatie/provider.ts'

const BATCH = 5
const DAILY_CAP = 300
/** Without lyrics (and not instrumental) a mood is a guess from the title. */
const NO_LYRICS_MAX_CONFIDENCE = 0.5
const LYRICS_CHARS = 2500

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
      signal: AbortSignal.timeout(10_000),
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

async function labelOne(song: Claimed): Promise<string> {
  const lyrics = await lyricsFor(song)
  const prompt = [
    `Title: ${song.title}`,
    `Artist: ${song.artist_name ?? 'unknown'}`,
    `Genre group: ${song.genre_group ?? 'unknown'}`,
    `Lyrics: ${lyrics.kind === 'found' ? `\n${lyrics.text}` : lyrics.kind === 'instrumental' ? 'INSTRUMENTAL' : 'NOT FOUND'}`,
  ].join('\n')

  const result = await generate(SYSTEM, [{ role: 'user', text: prompt }], {
    maxTokens: 120,
    temperature: 0.2,
    json: true,
    timeoutMs: 30_000,
    label: `vibe ${song.song_id.slice(0, 8)}`,
  })
  if (!result.ok) {
    await fail(song.song_id, `${result.reason}: ${result.detail ?? ''}`.slice(0, 300))
    return 'failed'
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
    model: currentModel(),
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
  // One at a time: gentle on Gemini's rate limits and on lrclib.
  for (const song of songs) {
    const outcome = await labelOne(song).catch(async (err) => {
      await fail(song.song_id, `error: ${(err as Error).message}`.slice(0, 300))
      return 'failed'
    })
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  console.log('[song-vibes]', JSON.stringify({ claimed: songs.length, ...outcomes }))
  return Response.json({ claimed: songs.length, ...outcomes })
})
