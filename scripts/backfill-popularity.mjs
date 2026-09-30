/**
 * Fills songs.popularity for rows cached before the column existed.
 *
 * New rows get ranked by spotify-search at cache time; this is only for the
 * back catalog. Safe to re-run — by default it skips rows that already have a
 * value, so it can be resumed if it's interrupted.
 *
 * Deezer's search is keyless but rate-limited to roughly 50 requests per
 * 5 seconds, so this goes in small batches with a pause between them.
 *
 * Usage (from beatboxed/):
 *   node scripts/backfill-popularity.mjs
 *   node scripts/backfill-popularity.mjs --all    # re-rank everything
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
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const ALL = process.argv.includes('--all')

const rest = (path, init = {}) =>
  fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()

async function deezerRank(title, artist) {
  const q = encodeURIComponent(`${title} ${artist}`)
  const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, {
    headers: { 'User-Agent': 'Beatboxed/0.1 (CSC 305 class project)' },
  })
  if (!res.ok) return null
  const hit = (await res.json()).data?.[0]
  if (!hit || typeof hit.rank !== 'number') return null

  // Same guard as the Edge Function: don't store a rank from a different act.
  const theirs = norm(hit.artist?.name ?? '')
  const ours = norm(artist)
  if (theirs && ours && !theirs.startsWith(ours.slice(0, 6))) return null
  return hit.rank
}

const filter = ALL ? '' : '&popularity=is.null'
const res = await rest(`songs?select=id,title,artists(name)${filter}`)
if (!res.ok) {
  console.error('Failed to read songs:', res.status, await res.text())
  process.exit(1)
}
const songs = await res.json()
console.log(`${songs.length} song(s) to rank${ALL ? ' (--all)' : ' (missing only)'}\n`)

let ranked = 0
let unmatched = 0

for (let i = 0; i < songs.length; i += 10) {
  const batch = songs.slice(i, i + 10)
  await Promise.all(
    batch.map(async (s) => {
      const artist = s.artists?.name ?? ''
      const rank = await deezerRank(s.title, artist)
      if (rank == null) {
        unmatched++
        console.log(`  --   ${s.title.slice(0, 30).padEnd(32)} ${artist.slice(0, 18)}`)
        return
      }
      const up = await rest(`songs?id=eq.${s.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ popularity: rank }),
      })
      if (!up.ok) {
        unmatched++
        console.error(`  ERR  ${s.title.slice(0, 30)} -> ${up.status}`)
        return
      }
      ranked++
      console.log(
        `  ${String(rank).padStart(7)}  ${s.title.slice(0, 30).padEnd(32)} ${artist.slice(0, 18)}`
      )
    })
  )
  // Stay under Deezer's ~50 requests / 5 seconds.
  await new Promise((r) => setTimeout(r, 1200))
}

console.log(`\nDone: ${ranked} ranked, ${unmatched} unmatched (left null).`)
