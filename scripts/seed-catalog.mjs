/**
 * One-time catalog fill. Calls the deployed spotify-search Edge Function for a
 * spread of genre-tagged queries so Home and Explore have something to show
 * before anyone has searched or reviewed.
 *
 * Spotify stopped returning `genres` for apps created after late 2024, so the
 * genre on each query is what tags the cached rows. That mapping lives here and
 * nowhere else.
 *
 * Usage (from the beatboxed/ directory, after deploying the functions):
 *   node scripts/seed-catalog.mjs
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

/** query -> genre we tag the results with. */
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

let ok = 0
let failed = 0

for (const [q, genre] of SEEDS) {
  const res = await fetch(`${URL_BASE}/functions/v1/spotify-search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q, type: 'track', limit: 10, genre }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    failed++
    console.error(`  FAIL ${q.padEnd(22)} ${res.status} ${body.error ?? ''}`)
  } else {
    ok++
    console.log(`  ok   ${q.padEnd(22)} cached ${body.cached ?? 0} songs (${genre})`)
  }

  // Stay well inside Spotify's rate limit.
  await new Promise((r) => setTimeout(r, 400))
}

console.log(`\nDone: ${ok} succeeded, ${failed} failed.`)
if (failed) process.exit(1)
