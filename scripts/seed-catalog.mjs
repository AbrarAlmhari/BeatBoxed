/**
 * One-time catalog fill. Calls the deployed spotify-search Edge Function for a
 * spread of genre-tagged artists so Home and Explore have something to show
 * before anyone has searched or reviewed.
 *
 * Each artist gets two calls:
 *   1. an artist-type search — the only search that returns artist images
 *      (/v1/artists?ids= and /artists/{id}/top-tracks are both 403 for this app)
 *   2. a scoped artist:"Name" track search, with the artist name passed through
 *      so the function filters on it. A bare name query matches song titles
 *      too: plain "Cigarettes After Sex" returns tracks by MATUNA and Rod Wave
 *      alongside the actual band.
 *
 * Spotify stopped returning `genres` for apps created after late 2024, so the
 * genre paired with each artist below is what tags their cached rows. That
 * mapping lives here and nowhere else.
 *
 * Usage (from the beatboxed/ directory, after deploying the functions):
 *   node scripts/seed-catalog.mjs
 *   node scripts/seed-catalog.mjs --reset   # clear the catalog first
 *
 * --reset deletes every songs/albums/artists row before re-seeding. Use it
 * when rows cached by an earlier, less accurate query need to go. It refuses
 * to run if any reviews exist, since reviews reference songs.
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) {
  console.error('Missing VITE_SUPABASE_URL or a Supabase key in .env.local')
  process.exit(1)
}

/** artist -> genre we tag their cached rows with. */
const SEEDS = [
  ['Radiohead', 'alternative'],
  ['Tame Impala', 'psychedelic'],
  ['Arctic Monkeys', 'indie rock'],
  ['Beach House', 'dream pop'],
  ['Bonobo', 'electronic'],
  ['Nujabes', 'lo-fi'],
  ['SZA', 'r&b'],
  ['Frank Ocean', 'r&b'],
  ['Kendrick Lamar', 'hip-hop'],
  ['Tyler, The Creator', 'hip-hop'],
  ['Dua Lipa', 'pop'],
  ['The Weeknd', 'pop'],
  ['Fairuz', 'arabic'],
  ['Amr Diab', 'arabic'],
  ['Mohammed Abdu', 'arabic'],
  ['Ludovico Einaudi', 'classical'],
  ['Khruangbin', 'funk'],
  ['Fleetwood Mac', 'rock'],
  ['Daft Punk', 'electronic'],
  ['Cigarettes After Sex', 'dream pop'],
]

async function call(body) {
  const res = await fetch(`${URL_BASE}/functions/v1/spotify-search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok && !json.error, status: res.status, json }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rest(path, init = {}) {
  return fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

async function countOf(table) {
  const res = await rest(`${table}?select=*`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(res.headers.get('content-range')?.split('/')[1] ?? 0)
}

if (process.argv.includes('--reset')) {
  const reviews = await countOf('reviews')
  if (reviews > 0) {
    console.error(
      `Refusing to reset: ${reviews} review(s) exist and reference songs. ` +
        'Delete them deliberately first if that is really what you want.'
    )
    process.exit(1)
  }

  console.log('Resetting catalog...')
  for (const table of ['songs', 'albums', 'artists']) {
    const before = await countOf(table)
    // PostgREST requires a filter on DELETE; this one matches every row.
    const res = await rest(`${table}?id=not.is.null`, { method: 'DELETE' })
    if (!res.ok) {
      console.error(`  failed to clear ${table}: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    console.log(`  cleared ${table} (${before} rows)`)
  }
  console.log('')
}

let ok = 0
let failed = 0

for (const [artist, genre] of SEEDS) {
  const a = await call({ q: artist, type: 'artist', limit: 3, genre })
  await sleep(250)

  const t = await call({
    q: `artist:"${artist}"`,
    type: 'track',
    limit: 10,
    genre,
    artistName: artist,
  })

  if (!a.ok || !t.ok) {
    failed++
    const why = a.json.error ?? t.json.error ?? `HTTP ${a.status}/${t.status}`
    console.error(`  FAIL ${artist.padEnd(22)} ${why}`)
  } else {
    ok++
    console.log(
      `  ok   ${artist.padEnd(22)} ${String(t.json.cached ?? 0).padStart(2)} songs, ` +
        `${t.json.artistsWithImages ?? 0} artist images (${genre})`
    )
  }

  // Stay well inside Spotify's rate limit.
  await sleep(400)
}

console.log(`\nDone: ${ok} succeeded, ${failed} failed.`)
if (failed) process.exit(1)
