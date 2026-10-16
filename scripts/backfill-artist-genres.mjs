/**
 * Fills artists.genres_raw / genres_source / genres_fetched_at (migration
 * 0031) for artists that have at least one song. Artists with no songs are
 * skipped and never touched.
 *
 *   1. Wikidata: "genre" (P136) of the item whose Spotify artist ID (P1902)
 *      matches, English labels. Asked 50 artists at a time.
 *   2. MusicBrainz, for those Wikidata had nothing for: the artist linked to
 *      the Spotify URL, then its genres (or, failing those, its tags with at
 *      least 2 votes). MusicBrainz asks for at most 1 request a second and a
 *      User-Agent that says who's asking; both are kept.
 *   3. Nothing found: genres_source = 'none', so it isn't asked again.
 *
 * Safe to stop and re-run: it only picks artists whose genres_fetched_at is
 * still null, and writes each artist as soon as it's done. No API keys.
 *
 * Usage (from beatboxed/):
 *   node scripts/backfill-artist-genres.mjs            # everything still missing
 *   node scripts/backfill-artist-genres.mjs --limit 50 # a trial run
 *
 * Prints a summary at the end: found on Wikidata / MusicBrainz / nothing,
 * and the raw genres that fell through to "Other" most often.
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

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity

const USER_AGENT = 'Beatboxed/1.0 (class project; https://github.com/AbrarAlmhari/BeatBoxed)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function db(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/** Artists still to do that have at least one song, in pages. */
async function pending() {
  const out = []
  for (let from = 0; ; from += 1000) {
    const rows = await db(
      `artists?select=id,name,spotify_id,songs!inner(id)&genres_fetched_at=is.null&songs.limit=1&order=name&offset=${from}&limit=1000`
    )
    out.push(...rows.map(({ id, name, spotify_id }) => ({ id, name, spotify_id })))
    if (rows.length < 1000) break
  }
  return out
}

/** Spotify ID -> English genre labels, for up to 50 artists in one query. */
async function wikidataGenres(spotifyIds) {
  const values = spotifyIds.map((id) => `"${id.replace(/"/g, '')}"`).join(' ')
  const query = `SELECT ?sid ?label WHERE {
    VALUES ?sid { ${values} }
    ?artist wdt:P1902 ?sid ; wdt:P136 ?genre .
    ?genre rdfs:label ?label . FILTER(lang(?label) = 'en')
  }`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
    })
    if (res.ok) {
      const body = await res.json()
      const out = new Map()
      for (const b of body.results.bindings) {
        const list = out.get(b.sid.value) ?? []
        if (!list.includes(b.label.value)) list.push(b.label.value)
        out.set(b.sid.value, list)
      }
      return out
    }
    console.warn(`  wikidata ${res.status}, retrying in ${attempt * 5}s`)
    await sleep(attempt * 5000)
  }
  throw new Error('Wikidata kept failing')
}

let lastMb = 0
/** A MusicBrainz call, never more than one a second. */
async function mb(path) {
  const wait = lastMb + 1100 - Date.now()
  if (wait > 0) await sleep(wait)
  lastMb = Date.now()
  const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (res.status === 404) return null
  if (res.status === 503) {
    await sleep(3000)
    return mb(path)
  }
  if (!res.ok) throw new Error(`musicbrainz ${res.status} for ${path}`)
  return res.json()
}

/** Genres from MusicBrainz for the artist linked to this Spotify ID. */
async function musicbrainzGenres(spotifyId) {
  const link = await mb(
    `url?resource=${encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`)}&inc=artist-rels&fmt=json`
  )
  const mbid = link?.relations?.find((r) => r.artist)?.artist?.id
  if (!mbid) return []
  const artist = await mb(`artist/${mbid}?inc=genres+tags&fmt=json`)
  const genres = (artist?.genres ?? []).filter((g) => g.count > 0).sort((a, b) => b.count - a.count)
  if (genres.length) return genres.slice(0, 8).map((g) => g.name)
  const tags = (artist?.tags ?? []).filter((t) => t.count >= 2).sort((a, b) => b.count - a.count)
  return tags.slice(0, 8).map((t) => t.name)
}

async function save(artist, raw, source) {
  await db(`artists?id=eq.${artist.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      genres_raw: raw.length ? raw : null,
      genres_source: source,
      genres_fetched_at: new Date().toISOString(),
    }),
  })
}

const todo = (await pending()).slice(0, LIMIT)
console.log(`${todo.length} artists with songs still need genres`)
const tally = { wikidata: 0, musicbrainz: 0, none: 0, failed: 0 }

for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50)
  const fromWikidata = await wikidataGenres(batch.filter((a) => a.spotify_id).map((a) => a.spotify_id))
  for (const artist of batch) {
    try {
      const wd = artist.spotify_id ? fromWikidata.get(artist.spotify_id) ?? [] : []
      if (wd.length) {
        await save(artist, wd, 'wikidata')
        tally.wikidata++
        continue
      }
      const mbGenres = artist.spotify_id ? await musicbrainzGenres(artist.spotify_id) : []
      if (mbGenres.length) {
        await save(artist, mbGenres, 'musicbrainz')
        tally.musicbrainz++
      } else {
        await save(artist, [], 'none')
        tally.none++
      }
    } catch (err) {
      // Left with genres_fetched_at null, so the next run tries it again.
      tally.failed++
      console.warn(`  ${artist.name}: ${err.message}`)
    }
  }
  await sleep(1000) // be gentle with the Wikidata query service too
  console.log(`  ${Math.min(i + 50, todo.length)}/${todo.length}  wikidata ${tally.wikidata} · musicbrainz ${tally.musicbrainz} · nothing ${tally.none} · failed ${tally.failed}`)
}

const unmapped = await db('genre_unmapped?select=raw,artists&limit=25')
console.log('\nSummary')
console.log(`  found on Wikidata:     ${tally.wikidata}`)
console.log(`  found on MusicBrainz:  ${tally.musicbrainz}`)
console.log(`  nothing found:         ${tally.none}`)
console.log(`  failed (re-run later): ${tally.failed}`)
console.log('\nMost common raw genres that map to Other (extend genre_map or genre_patterns):')
for (const u of unmapped) console.log(`  ${u.artists}  ${u.raw}`)
