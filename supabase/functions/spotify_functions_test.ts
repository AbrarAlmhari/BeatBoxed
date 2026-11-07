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

// Real Spotify ids are 22 letters and digits.
const ref = { id: 'artist0000000000000001', name: 'Fake Artist' }
const album = {
  id: 'album00000000000000001',
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
/** What the fake database holds, by table and then spotify_id. */
const saved = new Map<string, Map<string, Record<string, unknown>>>()
const savedRow = (table: string, id: string) => saved.get(table)?.get(id)
let deezerRanks: Record<string, number> = {}
let databaseFails = false
let lrclibAnswer = () => jsonResponse({ trackName: 'Fake Track', artistName: 'Fake Artist', plainLyrics: 'la la' })
const DB_DETAIL = 'duplicate key on hidden_internal_column'
const GENERIC = 'Something went wrong. Please try again.'
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
  if (url.host === 'api.deezer.com') {
    const q = url.searchParams.get('q') ?? ''
    const hit = Object.keys(deezerRanks).find((title) => q.startsWith(title))
    return jsonResponse({ data: hit ? [{ rank: deezerRanks[hit] }] : [] })
  }
  if (url.host === 'lrclib.net') {
    outsideCalls++
    return lrclibAnswer()
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
    if (databaseFails) return jsonResponse({ code: '23505', message: DB_DETAIL }, 500)
    if (request.method === 'GET') {
      return jsonResponse(url.searchParams.get('id') === `eq.${genreArtist.id}` ? [genreArtist] : [])
    }
    if (request.method === 'PATCH') {
      writes.push({ method: request.method, path: url.pathname })
      return one ? jsonResponse({ genre_buckets: [] }) : new Response(null, { status: 204 })
    }
    const rows = (await request.json()) as { spotify_id: string }[]
    writes.push({ method: request.method, path: url.pathname, body: rows })
    // Like the real database: rows in one request share a column list, and a
    // row missing a listed column gets null for it.
    const table = url.pathname.split('/').pop()!
    const columns = url.searchParams.get('columns')?.replace(/"/g, '').split(',') ?? Object.keys(rows[0])
    const stored = saved.get(table) ?? new Map<string, Record<string, unknown>>()
    saved.set(table, stored)
    const answer = rows.map((row) => {
      const next: Record<string, unknown> = { id: `id-${row.spotify_id}`, ...stored.get(row.spotify_id) }
      for (const column of columns) next[column] = (row as Record<string, unknown>)[column] ?? null
      stored.set(row.spotify_id, next)
      return next
    })
    return jsonResponse(answer, 201)
  }
  unexpected.push(url.href)
  throw new Error(`Unexpected call to ${url.href}`)
}) as typeof fetch

/* ------------------------------------------------------- the real servers */

const logged: string[] = []
const realConsoleError = console.error
console.error = (...args: unknown[]) => void logged.push(args.map((arg) => (typeof arg === 'string' ? arg : Deno.inspect(arg))).join(' '))

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
  saved.clear()
  deezerRanks = {}
  databaseFails = false
  lrclibAnswer = () => jsonResponse({ trackName: 'Fake Track', artistName: 'Fake Artist', plainLyrics: 'la la' })
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

// Keeping what's saved
const other = { id: 'artist-2', name: 'Other Artist' }
const otherTrack = { ...track, id: 'track-2', name: 'Other Track', artists: [other] }
const twoTracks = (u: URL) =>
  u.pathname === '/v1/search' ? jsonResponse({ tracks: { items: [track, otherTrack] } }) : workingSpotify(u)
const holding = (table: string, id: string, row: Record<string, unknown>) =>
  saved.set(table, (saved.get(table) ?? new Map()).set(id, row))

reset()
spotify = twoTracks
holding('songs', track.id, { genre: 'rock', popularity: 70 })
holding('songs', otherTrack.id, { genre: 'jazz', popularity: 40 })
holding('artists', ref.id, { genres: ['rock'], image_url: 'saved-image' })
const kept = await post(searchUrl, { q: 'x' })
check('search: a song keeps its genre and popularity when the new ones are missing', savedRow('songs', track.id)?.genre === 'rock' && savedRow('songs', track.id)?.popularity === 70, savedRow('songs', track.id))
check('search: an artist keeps its genres and image when the new ones are missing', JSON.stringify(savedRow('artists', ref.id)?.genres) === '["rock"]' && savedRow('artists', ref.id)?.image_url === 'saved-image', savedRow('artists', ref.id))
check('search: the answer shows the kept values', kept.json.songs?.some((s: { genre: string }) => s.genre === 'rock'), kept.json)

reset()
spotify = twoTracks
deezerRanks = { [track.name]: 90 }
holding('songs', otherTrack.id, { genre: 'jazz', popularity: 40 })
await post(searchUrl, { q: 'x' })
check('search: a new popularity is saved', savedRow('songs', track.id)?.popularity === 90, savedRow('songs', track.id))
check('search: it does not blank another song in the same search', savedRow('songs', otherTrack.id)?.popularity === 40 && savedRow('songs', otherTrack.id)?.genre === 'jazz', savedRow('songs', otherTrack.id))

reset()
spotify = twoTracks
holding('songs', track.id, { genre: 'rock', popularity: 70 })
await post(searchUrl, { q: 'x', genre: 'jazz' }, SERVICE_KEY)
check('search: a real new genre from the seed script replaces the old one', savedRow('songs', track.id)?.genre === 'jazz', savedRow('songs', track.id))

reset()
spotify = (u) =>
  u.pathname === '/v1/search'
    ? jsonResponse({ artists: { items: [{ ...ref, images: [], genres: ['pop'] }, { ...other, images: [], genres: [] }] } })
    : workingSpotify(u)
holding('artists', other.id, { genres: ['folk'] })
await post(searchUrl, { q: 'x', type: 'artist' })
check('search: new genres are saved, and an artist with none keeps theirs', JSON.stringify(savedRow('artists', ref.id)?.genres) === '["pop"]' && JSON.stringify(savedRow('artists', other.id)?.genres) === '["folk"]', [savedRow('artists', ref.id), savedRow('artists', other.id)])

reset()
spotify = (u) =>
  u.pathname === `/v1/artists/${ref.id}/albums`
    ? jsonResponse({ items: [{ ...album, id: 'album-2', artists: [other] }], next: null })
    : u.pathname === `/v1/artists/${ref.id}`
    ? jsonResponse({ ...ref, images: [{ url: 'new-image', width: 1, height: 1 }] })
    : workingSpotify(u)
holding('artists', ref.id, { genres: ['rock'] })
holding('artists', other.id, { genres: ['folk'], image_url: 'saved-image' })
await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist sync: it saves the new image and keeps the genres', savedRow('artists', ref.id)?.image_url === 'new-image' && JSON.stringify(savedRow('artists', ref.id)?.genres) === '["rock"]', savedRow('artists', ref.id))
check('artist sync: a collaborator keeps their image and genres', savedRow('artists', other.id)?.image_url === 'saved-image' && JSON.stringify(savedRow('artists', other.id)?.genres) === '["folk"]', savedRow('artists', other.id))

reset()
holding('songs', track.id, { genre: 'rock', popularity: 70 })
holding('artists', ref.id, { genres: ['rock'] })
await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album sync: a song keeps its genre and popularity', savedRow('songs', track.id)?.genre === 'rock' && savedRow('songs', track.id)?.popularity === 70, savedRow('songs', track.id))

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
check('search: Premium refusal is a 502 saying Spotify is unavailable', r.status === 502 && r.json.error === 'Spotify is unavailable right now.', r.json)
check('search: the browser gets the status, not the reason', r.json.spotify?.status === 403 && r.json.spotify?.retryAfterSeconds === null && !r.text.includes('premium'), r.json)
check('search: the refusal is logged', logged.join(' ').includes('Active premium'), logged)
check('search: a refusal makes one call and writes nothing', spotifyCalls === 1 && writes.length === 0, { spotifyCalls, writes })

reset()
spotify = () => jsonResponse({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'Retry-After': '120' })
r = await post(searchUrl, { q: 'x' })
check('search: rate limit passes Retry-After along', r.status === 502 && r.json.spotify?.status === 429 && r.json.spotify?.retryAfterSeconds === 120, r.json)

reset()
tokenAnswer = () => jsonResponse({ error: 'invalid_client', error_description: 'Invalid client secret' }, 400)
r = await post(searchUrl, { q: 'x' })
check('search: a refused token is a 502, with the reason only in the logs', r.status === 502 && !r.text.includes('client secret') && logged.join(' ').includes('Invalid client secret'), { json: r.json, logged })
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
check('artist: Premium refusal is a 502 saying Spotify is unavailable', r.status === 502 && r.json.error === 'Spotify is unavailable right now.', r.json)
check('artist: the browser gets the status, not the reason', r.json.spotify?.status === 403 && !r.text.includes('premium'), r.json)
check('artist: the refusal is logged', logged.join(' ').includes('Active premium'), logged)
check('artist: a refusal stops at the first call and writes nothing', spotifyCalls === 1 && writes.length === 0, { spotifyCalls, writes })

reset()
spotify = premiumRefusal
r = await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album: Premium refusal is a 502 without the reason', r.status === 502 && r.json.spotify?.status === 403 && !r.text.includes('premium'), r.json)

reset()
spotify = (url) =>
  url.pathname.endsWith('/tracks') ? jsonResponse({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'Retry-After': '30' }) : workingSpotify(url)
r = await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album: a refusal partway through is passed along', r.status === 502 && r.json.spotify?.retryAfterSeconds === 30, r.json)

reset()
tokenAnswer = () => new Response('<html>Bad gateway</html>', { status: 502 })
r = await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist: a meaningless token answer gives just the status', r.status === 502 && r.json.spotify?.status === 502, r.json)
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

// Album covers
const coverless = { ...album, images: [] }
const covered = { ...album, id: 'album-3', name: 'Covered Album', images: [{ url: 'new-cover', width: 1, height: 1 }] }

reset()
spotify = (u) => (u.pathname === '/v1/search' ? jsonResponse({ tracks: { items: [{ ...track, album: coverless }] } }) : workingSpotify(u))
holding('albums', album.id, { cover_url: 'saved-cover' })
await post(searchUrl, { q: 'x' })
check('search: an album keeps its cover when the new one is missing', savedRow('albums', album.id)?.cover_url === 'saved-cover', savedRow('albums', album.id))

reset()
spotify = (u) =>
  u.pathname === '/v1/search'
    ? jsonResponse({ tracks: { items: [{ ...track, album: coverless }, { ...otherTrack, album: covered }] } })
    : workingSpotify(u)
holding('albums', album.id, { cover_url: 'saved-cover' })
await post(searchUrl, { q: 'x' })
check('search: a new cover is saved, and does not blank another album in the same search', savedRow('albums', covered.id)?.cover_url === 'new-cover' && savedRow('albums', album.id)?.cover_url === 'saved-cover', [savedRow('albums', covered.id), savedRow('albums', album.id)])

reset()
spotify = (u) => (u.pathname === `/v1/artists/${ref.id}/albums` ? jsonResponse({ items: [coverless, covered], next: null }) : workingSpotify(u))
holding('albums', album.id, { cover_url: 'saved-cover' })
await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist sync: an album keeps its cover when the new one is missing', savedRow('albums', album.id)?.cover_url === 'saved-cover', savedRow('albums', album.id))
check('artist sync: a new cover is saved', savedRow('albums', covered.id)?.cover_url === 'new-cover', savedRow('albums', covered.id))

reset()
spotify = (u) => (u.pathname === `/v1/albums/${album.id}` ? jsonResponse(coverless) : workingSpotify(u))
holding('albums', album.id, { cover_url: 'saved-cover' })
await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album sync: an album keeps its cover when the new one is missing', savedRow('albums', album.id)?.cover_url === 'saved-cover', savedRow('albums', album.id))

// Album details
const bareAlbum = { ...album } as Record<string, unknown>
delete bareAlbum.release_date
delete bareAlbum.total_tracks
delete bareAlbum.album_type
delete bareAlbum.album_group
const fullAlbum = { ...album, id: 'album-4', name: 'Full Album', release_date: '2021-02-03', total_tracks: 9, album_type: 'single' }
const savedDetails = { release_date: '1997-05-21', total_tracks: 12, album_type: 'album' }
const keptDetails = (row?: Record<string, unknown>) =>
  row?.release_date === savedDetails.release_date && row?.total_tracks === savedDetails.total_tracks && row?.album_type === savedDetails.album_type

reset()
spotify = (u) => (u.pathname === `/v1/albums/${album.id}` ? jsonResponse(bareAlbum) : workingSpotify(u))
holding('albums', album.id, savedDetails)
await post(artistUrl, { action: 'album', spotifyId: album.id })
check('album sync: release date, track count and type stay when Spotify leaves them out', keptDetails(savedRow('albums', album.id)), savedRow('albums', album.id))

reset()
spotify = (u) => (u.pathname === `/v1/artists/${ref.id}/albums` ? jsonResponse({ items: [bareAlbum, fullAlbum], next: null }) : workingSpotify(u))
holding('albums', album.id, savedDetails)
await post(artistUrl, { action: 'discography', spotifyId: ref.id })
check('artist sync: they stay too, next to an album that has them', keptDetails(savedRow('albums', album.id)), savedRow('albums', album.id))
check(
  'artist sync: new values are saved',
  savedRow('albums', fullAlbum.id)?.release_date === '2021-02-03' && savedRow('albums', fullAlbum.id)?.total_tracks === 9 && savedRow('albums', fullAlbum.id)?.album_type === 'single',
  savedRow('albums', fullAlbum.id)
)

reset()
spotify = (u) => (u.pathname === '/v1/search' ? jsonResponse({ tracks: { items: [{ ...track, album: bareAlbum }] } }) : workingSpotify(u))
holding('albums', album.id, savedDetails)
await post(searchUrl, { q: 'x' })
check('search: a saved release date stays when Spotify leaves it out', savedRow('albums', album.id)?.release_date === savedDetails.release_date, savedRow('albums', album.id))

reset()
spotify = (u) => (u.pathname === '/v1/search' ? jsonResponse({ tracks: { items: [{ ...track, album: { ...album, release_date: '1997' } }] } }) : workingSpotify(u))
await post(searchUrl, { q: 'x' })
check('search: a year-only release date still becomes January 1st', savedRow('albums', album.id)?.release_date === '1997-01-01', savedRow('albums', album.id))

// spotifyId
for (const [label, bad] of [
  ['too short', 'abc'],
  ['too long', ref.id + 'x'],
  ['a path', '../../v1/me000000000000'],
  ['a query', '"} UNION SELECT ?x WHERE'],
  ['not text', 12345],
] as const) {
  for (const action of ['discography', 'album', 'bio']) {
    reset()
    r = await post(artistUrl, { action, spotifyId: bad })
    check(`spotifyId: ${label} is a 400 for ${action} and calls nobody`, r.status === 400 && spotifyCalls === 0 && outsideCalls === 0 && writes.length === 0, { json: r.json, spotifyCalls, outsideCalls, writes })
  }
}

reset()
r = await post(genresUrl, { artistId: 'not-a-uuid' })
check('genres: an id that is not a uuid is a 400', r.status === 400 && outsideCalls === 0, r.json)

// Plain errors in the browser, details in the logs
const failing: [string, string, unknown][] = [
  ['search', searchUrl, { q: 'x' }],
  ['artist', artistUrl, { action: 'discography', spotifyId: ref.id }],
  ['genres', genresUrl, { artistId: genreArtist.id }],
]
for (const [name, url, body] of failing) {
  reset()
  databaseFails = true
  r = await post(url, body)
  check(`${name}: a database error gives the browser a plain message`, r.status === 500 && r.json.error === GENERIC && !r.text.includes(DB_DETAIL), r.json)
  check(`${name}: the details go to the logs`, logged.join(' ').includes(DB_DETAIL), logged)
}

reset()
lrclibAnswer = () => new Response('secret upstream page', { status: 500 })
r = await post(lyricsUrl, { artist: 'a', track: 'b' })
check('lyrics: an outside failure gives a plain message', r.status === 502 && r.json.error === GENERIC, r.json)
check('lyrics: the details go to the logs', logged.join(' ').includes('lrclib returned 500'), logged)

reset()
lrclibAnswer = () => new Response('not found', { status: 404 })
r = await post(lyricsUrl, { artist: 'a', track: 'b' })
check('lyrics: no lyrics is still a normal answer', r.status === 200 && r.json.found === false, r.json)

reset()
const broken = await globalThis.fetch(searchUrl, { method: 'POST', headers: { Authorization: `Bearer ${USER_TOKEN}` }, body: 'not json' })
const brokenText = await broken.text()
check('search: a broken request gets no internal details', broken.status === 500 && JSON.parse(brokenText).error === GENERIC, brokenText)

check('nothing else was called', unexpected.length === 0, unexpected)

/* ---------------------------------------------------------------- result */

console.error = realConsoleError
await Promise.all(servers.map((server) => server.shutdown()))
globalThis.fetch = realFetch
const failed = results.filter(([, ok]) => !ok)
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
Deno.exit(failed.length ? 1 : 0)
