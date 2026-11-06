// Runs spotify-search, spotify-artist, lyrics-lookup and artist-genres as real
// local servers, against a fake Spotify, Deezer, lrclib, Wikidata, MusicBrainz,
// login service and database. No real calls: anything else a function tries to
// reach fails the run.
// Run with: npm run test:functions
const SUPABASE = 'http://supabase.test'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const SERVICE_KEY = 'test-service-role'
const USER_TOKEN = 'test-user-session'
const PUBLIC_KEY = 'test-public-key'
const PREMIUM =
  'Active premium subscription required for the owner of the app. When the subscription status changes, it can take a few hours before requests are allowed again.'

Deno.env.set('SUPABASE_URL', SUPABASE)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
Deno.env.set('SPOTIFY_CLIENT_ID', 'test-client-id')
Deno.env.set('SPOTIFY_CLIENT_SECRET', CLIENT_SECRET)

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/* --------------------------------------------------------- the fakes */

const ref = { id: 'artist-1', name: 'Fake Artist' }
const album = {
  id: 'album-1',
  name: 'Fake Album',
  images: [],
  release_date: '2020-01-01',
  total_tracks: 1,
  artists: [ref],
}
const genreArtist = { id: '00000000-0000-4000-8000-000000000002', spotify_id: ref.id, genres_fetched_at: null, genre_buckets: [] }
const track = { id: 'track-1', name: 'Fake Track', duration_ms: 1000, track_number: 1, disc_number: 1, artists: [ref], album }

function workingSpotify(url: URL) {
  const path = url.pathname
  if (path === '/v1/search') {
    return jsonResponse(
      url.searchParams.get('type') === 'artist'
        ? { artists: { items: [{ ...ref, images: [] }] } }
        : { tracks: { items: [track] } }
    )
  }
  if (path === `/v1/artists/${ref.id}`) return jsonResponse({ ...ref, images: [] })
  if (path === `/v1/artists/${ref.id}/albums`) return jsonResponse({ items: [album], next: null })
  if (path === `/v1/albums/${album.id}`) return jsonResponse(album)
  if (path === `/v1/albums/${album.id}/tracks`) return jsonResponse({ items: [track], next: null })
  return jsonResponse({ error: { status: 404, message: 'Not found in the fake' } }, 404)
}

let spotify = workingSpotify
let tokenAnswer = () => jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 0 })
let spotifyCalls = 0
const writes: { method: string; path: string; body?: unknown }[] = []
let outsideCalls = 0
const unexpected: string[] = []
const realFetch = globalThis.fetch

/** Our own servers go through for real. Everything else is answered here. */
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname === '127.0.0.1') return realFetch(input, init)
  if (url.host === 'accounts.spotify.com') return tokenAnswer()
  if (url.host === 'api.spotify.com') {
    spotifyCalls++
    return spotify(url)
  }
  if (url.host === 'api.deezer.com') return jsonResponse({ data: [] })
  if (url.host === 'lrclib.net') {
    outsideCalls++
    return jsonResponse({ trackName: 'Fake Track', artistName: 'Fake Artist', plainLyrics: 'la la' })
  }
  if (url.host === 'query.wikidata.org') {
    outsideCalls++
    return jsonResponse({ results: { bindings: [] } })
  }
  if (url.host === 'musicbrainz.org') {
    outsideCalls++
    return jsonResponse({ relations: [] })
  }
  if (url.origin === SUPABASE) {
    const one = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object')
    if (url.pathname === '/auth/v1/user') {
      return request.headers.get('authorization') === `Bearer ${USER_TOKEN}`
        ? jsonResponse({ id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'fake@beatboxed.test' })
        : jsonResponse({ message: 'invalid JWT' }, 401)
    }
    if (request.method === 'GET') {
      return jsonResponse(url.searchParams.get('id') === `eq.${genreArtist.id}` ? [genreArtist] : [])
    }
    if (request.method === 'PATCH') {
      writes.push({ method: request.method, path: url.pathname })
      return one ? jsonResponse({ genre_buckets: [] }) : new Response(null, { status: 204 })
    }
    const rows = (await request.json()) as { spotify_id: string }[]
    writes.push({ method: request.method, path: url.pathname, body: rows })
    return jsonResponse(rows.map((row) => ({ ...row, id: `id-${row.spotify_id}` })), 201)
  }
  unexpected.push(url.href)
  throw new Error(`Unexpected call to ${url.href}`)
}) as typeof fetch

/* ------------------------------------------------------- the real servers */

const logged: string[] = []
const realConsoleError = console.error
console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '))

const realServe = Deno.serve
const servers: { shutdown(): Promise<void> }[] = []
let listening = (_port: number) => {}
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (handler: (req: Request) => Response | Promise<Response>) => {
    const server = realServe({ port: 0, hostname: '127.0.0.1', onListen: ({ port }) => listening(port) }, handler)
    servers.push(server)
    return server
  },
})

async function start(path: string) {
  const port = new Promise<number>((resolve) => (listening = resolve))
  await import(path)
  return `http://127.0.0.1:${await port}`
}

const searchUrl = await start('./spotify-search/index.ts')
const artistUrl = await start('./spotify-artist/index.ts')
const lyricsUrl = await start('./lyrics-lookup/index.ts')
const genresUrl = await start('./artist-genres/index.ts')

async function post(base: string, body: unknown, token: string | null = USER_TOKEN) {
  const res = await globalThis.fetch(base, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, json: JSON.parse(text) }
}

/* ------------------------------------------------------------ the checks */

const results: [string, boolean, string?][] = []
const check = (name: string, ok: boolean, detail?: unknown) => results.push([name, ok, detail === undefined ? undefined : JSON.stringify(detail)])

function reset() {
  spotify = workingSpotify
  tokenAnswer = () => jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 0 })
  spotifyCalls = 0
  outsideCalls = 0
  writes.length = 0
  logged.length = 0
}

const premiumRefusal = () => new Response(PREMIUM, { status: 403 })

// Logging in
const lockedFunctions: [string, string, unknown][] = [
  ['search', searchUrl, { q: 'x' }],
  ['artist', artistUrl, { action: 'discography', spotifyId: ref.id }],
  ['lyrics', lyricsUrl, { artist: 'Fake Artist', track: 'Fake Track' }],
  ['genres', genresUrl, { artistId: genreArtist.id }],
]
for (const [name, url, body] of lockedFunctions) {
  for (const [who, token] of [['no token', null], ['the public key', PUBLIC_KEY], ['a made-up token', 'expired-or-fake']] as const) {
    reset()
    const refused = await post(url, body, token)
    check(`${name}: ${who} is a 401 and does nothing`, refused.status === 401 && spotifyCalls === 0 && outsideCalls === 0 && writes.length === 0, { status: refused.status, spotifyCalls, outsideCalls, writes })
  }
  reset()
  const allowed = await post(url, body)
  check(`${name}: a logged-in user gets through`, allowed.status === 200, allowed.json)
}

reset()
await post(searchUrl, { q: 'x', genre: 'made-up genre' })
check('search: a user cannot label songs or artists with a genre', !JSON.stringify(writes).includes('made-up genre'), writes)

reset()
const seeded = await post(searchUrl, { q: 'x', genre: 'rock' }, SERVICE_KEY)
check('search: the seed script still can', seeded.status === 200 && JSON.stringify(writes).includes('rock'), { json: seeded.json, writes })

// spotify-search
const options = await globalThis.fetch(searchUrl, { method: 'OPTIONS' })
await options.body?.cancel()
check('search: answers the browser preflight', options.status === 200 && options.headers.get('access-control-allow-origin') === '*')

let r = await post(searchUrl, {})
check('search: a missing query is a 400', r.status === 400, r.json)

reset()
r = await post(searchUrl, { q: 'x', type: 'nonsense' })
check('search: an unknown type is a 400 and calls nobody', r.status === 400 && spotifyCalls === 0, r.json)

reset()
spotify = premiumRefusal
r = await post(searchUrl, { q: 'x' })
check('search: Premium refusal is a 502 with the reason', r.status === 502 && r.json.error === `Spotify search failed: 403. ${PREMIUM}`, r.json)
check('search: the details are passed along', r.json.spotify?.status === 403 && r.json.spotify?.reason === PREMIUM && r.json.spotify?.retryAfterSeconds === null, r.json)
check('search: the refusal is logged', logged.join(' ').includes('Active premium'), logged)
check('search: a refusal makes one call and writes nothing', spotifyCalls === 1 && writes.length === 0, { spotifyCalls, writes })

reset()
spotify = () => jsonResponse({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'Retry-After': '120' })
r = await post(searchUrl, { q: 'x' })
check('search: rate limit passes Retry-After along', r.status === 502 && r.json.spotify?.status === 429 && r.json.spotify?.retryAfterSeconds === 120, r.json)

reset()
tokenAnswer = () => jsonResponse({ error: 'invalid_client', error_description: 'Invalid client secret' }, 400)
r = await post(searchUrl, { q: 'x' })
check('search: a refused token is a 502 with the reason', r.status === 502 && r.json.error === 'Spotify token request failed: 400. Invalid client secret', r.json)
check('search: a refused token never asks for results', spotifyCalls === 0)
check('search: the answer holds no secret', !r.text.includes(CLIENT_SECRET) && !r.text.includes('test-service-role'), r.text)

reset()
r = await post(searchUrl, { q: 'x' })
check('search: a working track search saves and returns songs', r.status === 200 && r.json.songs?.length === 1 && r.json.songs[0].title === 'Fake Track', r.json)
check('search: it saved artist, album and song', ['artists', 'albums', 'songs'].every((t) => writes.some((w) => w.path === `/rest/v1/${t}`)), writes)

reset()
r = await post(searchUrl, { q: 'x', type: 'artist' })
check('search: a working artist search answers', r.status === 200 && r.json.type === 'artist', r.json)

// spotify-artist
reset()
r = await post(artistUrl, { action: 'discography' })
check('artist: a missing id is a 400', r.status === 400, r.json)

reset()
spotify = premiumRefusal
r = await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist: Premium refusal is a 502 with the reason', r.status === 502 && r.json.error === `Spotify artist lookup failed: 403. ${PREMIUM}`, r.json)
check('artist: the details are passed along', r.json.spotify?.status === 403 && r.json.spotify?.reason === PREMIUM, r.json)
check('artist: the refusal is logged', logged.join(' ').includes('Active premium'), logged)
check('artist: a refusal stops at the first call and writes nothing', spotifyCalls === 1 && writes.length === 0, { spotifyCalls, writes })

reset()
spotify = premiumRefusal
r = await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album: Premium refusal is a 502 with the reason', r.status === 502 && r.json.spotify?.reason === PREMIUM, r.json)

reset()
spotify = (url) =>
  url.pathname.endsWith('/tracks') ? jsonResponse({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'Retry-After': '30' }) : workingSpotify(url)
r = await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album: a refusal partway through is passed along', r.status === 502 && r.json.spotify?.retryAfterSeconds === 30, r.json)

reset()
tokenAnswer = () => new Response('<html>Bad gateway</html>', { status: 502 })
r = await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist: a meaningless token answer gives just the status', r.status === 502 && r.json.error === 'Spotify token request failed: 502' && r.json.spotify?.reason === null, r.json)
check('artist: the answer holds no secret', !r.text.includes(CLIENT_SECRET) && !r.text.includes(ACCESS_TOKEN), r.text)

reset()
r = await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist: a working sync reports the albums', r.status === 200 && r.json.albums === 1 && r.json.firstEverSync === true, r.json)
check('artist: it stamps the sync time', writes.some((w) => w.method === 'PATCH' && w.path === '/rest/v1/artists'), writes)

reset()
r = await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album: a working sync saves the tracks', r.status === 200 && r.json.tracks === 1 && r.json.totalTracks === 1, r.json)
check('album: it saved the song', writes.some((w) => w.path === '/rest/v1/songs'), writes)

reset()
r = await post(artistUrl, { action: 'bio', spotifyId: ref.id })
check('bio: a miss is stamped, without calling Spotify', r.status === 200 && r.json.bio === null && spotifyCalls === 0 && writes.some((w) => w.method === 'PATCH'), { json: r.json, spotifyCalls, writes })

check('nothing else was called', unexpected.length === 0, unexpected)

/* ---------------------------------------------------------------- result */

console.error = realConsoleError
await Promise.all(servers.map((server) => server.shutdown()))
globalThis.fetch = realFetch
const failed = results.filter(([, ok]) => !ok)
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
Deno.exit(failed.length ? 1 : 0)
