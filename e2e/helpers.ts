import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'

/** Service-role REST helper, used only to create and destroy test fixtures. */
export const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
) as Record<string, string>

const SB = env.VITE_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY

export async function adminFetch(path: string, init: RequestInit = {}) {
  return admin(path, init)
}

async function admin(path: string, init: RequestInit = {}) {
  return fetch(`${SB}${path}`, {
    ...init,
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/** Marks every account this suite creates, so cleanup can find them all. */
export const TEST_DOMAIN = '@beatboxed.test'
export const TEST_PASSWORD = 'TestPw123456'

export async function createTestUser(local: string) {
  const email = `${local}${TEST_DOMAIN}`
  await deleteTestUsers(email)
  const res = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${email}: ${JSON.stringify(body)}`)
  return { id: body.id as string, email }
}

/** Removes suite accounts and anything they own. Safe to call repeatedly. */
export async function deleteTestUsers(onlyEmail?: string) {
  const res = await admin('/auth/v1/admin/users?page=1&per_page=200')
  const { users = [] } = await res.json()
  for (const u of users) {
    const email: string = u.email ?? ''
    if (!email.endsWith(TEST_DOMAIN)) continue
    if (onlyEmail && email !== onlyEmail) continue
    await admin(`/rest/v1/follows?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/play_history?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/notification_preferences?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/review_likes?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/reviews?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/notifications?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/friendships?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/friendships?friend_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/user_follows?follower_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/user_follows?following_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/playlists?user_id=eq.${u.id}`, { method: 'DELETE' })
    await removeCoverFolder(u.id)
    await admin(`/rest/v1/song_views?user_id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/rest/v1/profiles?id=eq.${u.id}`, { method: 'DELETE' })
    await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' })
  }
}

/** Two songs that share one artist — the whole point of the follow test. */
export async function twoSongsBySameArtist() {
  const res = await admin(
    '/rest/v1/songs?select=id,title,artist_id,artists(name)&limit=400'
  )
  const rows = (await res.json()) as {
    id: string
    title: string
    artist_id: string
    artists: { name: string } | null
  }[]
  const byArtist = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!r.artist_id) continue
    byArtist.set(r.artist_id, [...(byArtist.get(r.artist_id) ?? []), r])
  }
  for (const [artistId, songs] of byArtist) {
    if (songs.length >= 2) {
      return {
        artistId,
        artistName: songs[0].artists?.name ?? '',
        first: songs[0],
        second: songs[1],
      }
    }
  }
  throw new Error('no artist in the catalog has two songs')
}

export async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'))
}

export async function logout(page: Page) {
  // Log out lives in Settings now, not on the profile page.
  await page.goto('/settings')
  await page.getByRole('button', { name: /log out/i }).click()
  await page.waitForURL(/\/login/)
}

/** The artist Follow/Following control on a song page. */
export function followButton(page: Page) {
  return page.getByRole('button', { name: /follow this artist|unfollow this artist/i })
}

/**
 * Runs an action that writes a follow and resolves once the server has
 * answered. Without this a test can navigate away mid-write: the optimistic
 * label says "Following" while the aborted request never reaches Postgres.
 */
export async function awaitFollowWrite(
  page: Page,
  method: 'POST' | 'DELETE',
  action: () => Promise<void>
) {
  const settled = page.waitForResponse(
    (r) =>
      r.url().includes('/rest/v1/follows') &&
      r.request().method() === method &&
      r.status() < 400
  )
  await action()
  await settled
}

/**
 * Times the gap between the tap and the button's label actually changing,
 * measured inside the page so it excludes Playwright's own round trips.
 *
 * Returns null if the label never changed. The point is that the label is
 * optimistic: it must not wait on the follows write, which takes ~200ms.
 */
export async function measureLabelFlip(
  page: Page,
  action: () => Promise<void>
): Promise<number | null> {
  await followButton(page).evaluate((el) => {
    const w = window as unknown as { __flipMs: number | null }
    w.__flipMs = null
    let tapped: number | null = null
    const before = el.textContent
    el.addEventListener('click', () => (tapped = performance.now()), {
      capture: true,
      once: true,
    })
    const obs = new MutationObserver(() => {
      if (tapped === null || w.__flipMs !== null) return
      if (el.textContent === before) return
      w.__flipMs = performance.now() - tapped
      obs.disconnect()
    })
    obs.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  })

  await action()

  return page.evaluate(
    () => (window as unknown as { __flipMs: number | null }).__flipMs
  )
}

/** A song we can drive the player with, named so assertions read clearly. */
export type PlayableSong = { id: string; title: string; artistName: string }

/**
 * Clears a user's uploaded covers. Deleting the account doesn't: storage
 * objects aren't rows, so nothing cascades, and a suite that uploads would
 * otherwise leave files behind in the shared bucket on every run.
 */
async function removeCoverFolder(userId: string) {
  const listed = await fetch(`${SB}/storage/v1/object/list/playlist-covers`, {
    method: 'POST',
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: userId, limit: 100 }),
  })
  const files = (await listed.json()) as { name: string }[]
  if (!Array.isArray(files) || files.length === 0) return
  await fetch(`${SB}/storage/v1/object/playlist-covers`, {
    method: 'DELETE',
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: files.map((f) => `${userId}/${f.name}`) }),
  })
}

/** Two songs with different titles, for ordering and exclusion checks. */
export async function twoDistinctSongs(): Promise<[PlayableSong, PlayableSong]> {
  const res = await admin(
    '/rest/v1/songs?select=id,title,artists(name)&order=title&limit=200'
  )
  const rows = (await res.json()) as {
    id: string
    title: string
    artists: { name: string } | null
  }[]

  const picked: PlayableSong[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const key = r.title.trim().toLowerCase()
    // Distinct titles, because the rail collapses same-title duplicates and
    // the assertions below identify cards by title.
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ id: r.id, title: r.title, artistName: r.artists?.name ?? '' })
    if (picked.length === 2) break
  }
  if (picked.length < 2) throw new Error('need two songs with distinct titles')
  return [picked[0], picked[1]]
}

/** Same, for however many the test needs. */
export async function distinctSongs(count: number): Promise<PlayableSong[]> {
  const res = await admin(
    '/rest/v1/songs?select=id,title,artists(name)&order=title&limit=400'
  )
  const rows = (await res.json()) as {
    id: string
    title: string
    artists: { name: string } | null
  }[]
  const picked: PlayableSong[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const key = r.title.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ id: r.id, title: r.title, artistName: r.artists?.name ?? '' })
    if (picked.length === count) break
  }
  if (picked.length < count) throw new Error(`need ${count} distinct song titles`)
  return picked
}

/** Builds a playlist straight through the API, for tests about playback. */
export async function createPlaylistWithSongs(
  userId: string,
  title: string,
  songIds: string[]
) {
  const res = await admin('/rest/v1/playlists', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, title }),
  })
  const [row] = (await res.json()) as { id: string }[]
  if (songIds.length) {
    await admin('/rest/v1/playlist_songs', {
      method: 'POST',
      body: JSON.stringify(
        songIds.map((song_id, position) => ({
          playlist_id: row.id,
          song_id,
          position,
        }))
      ),
    })
  }
  return row.id
}

/** 8-bit mono silence, long enough to outlast the 5-second play threshold. */
function silentWav(seconds: number) {
  const rate = 8000
  const samples = rate * seconds
  const buf = Buffer.alloc(44 + samples)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples, 40)
  buf.fill(128, 44) // midpoint == silence for unsigned 8-bit
  return buf
}

const CLIP_URL = 'https://preview.beatboxed.test/clip.wav'

/**
 * Makes playback deterministic and offline.
 *
 * Without this the test depends on the live iTunes Search API and Apple's
 * CDN, and on whichever recording iTunes happens to rank first. Instead the
 * lookup is answered locally and the audio is a generated silent clip, so the
 * only thing under test is our own play accounting.
 *
 * It also swallows the PATCH that caches the matched iTunes id: these songs
 * live in the shared project, and persisting a fake track id would leave the
 * team's catalog pointing at a preview that doesn't exist.
 */
export async function stubPreviewAudio(
  page: Page,
  songs: PlayableSong[],
  /** Song ids the stubbed lookup should report as having no preview. */
  noPreviewFor: string[] = []
) {
  const wav = silentWav(30)
  const silentIds = new Set(noPreviewFor)
  await installAudioProbe(page)

  await page.route(/itunes\.apple\.com/, async (route) => {
    const url = new URL(route.request().url())
    const term = (url.searchParams.get('term') ?? '').toLowerCase()
    const song =
      songs.find((s) => term.includes(s.title.toLowerCase())) ?? songs[0]

    // An empty result set is exactly what iTunes returns for a song it
    // doesn't carry, so the app takes its real no-preview path.
    if (silentIds.has(song.id)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resultCount: 0, results: [] }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resultCount: 1,
        results: [
          {
            trackId: 999000001,
            trackName: song.title,
            artistName: song.artistName,
            previewUrl: CLIP_URL,
            kind: 'song',
          },
        ],
      }),
    })
  })

  // Honours Range like Apple's CDN does. Without it Chrome marks the clip
  // unseekable and snaps every seek to 0, so resume could never be tested.
  await page.route(CLIP_URL, async (route) => {
    const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers()['range'] ?? '')
    if (!range) {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', 'content-length': String(wav.length) },
        body: wav,
      })
      return
    }
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
    await route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${wav.length}`,
        'content-length': String(end - start + 1),
      },
      body: wav.subarray(start, end + 1),
    })
  })

  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/songs'),
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      await route.fulfill({ status: 204, body: '' })
    }
  )
}

/** The Rail section with this heading, or nothing if it isn't rendered. */
export function rail(page: Page, title: string) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

/** Song ids of the cards in a rail, in display order. */
export async function railSongIds(page: Page, title: string) {
  const links = rail(page, title).locator('a[href^="/song/"]')
  return links.evaluateAll((els) =>
    els.map((el) => (el.getAttribute('href') ?? '').replace('/song/', ''))
  )
}

/** Reads a user's play_history straight from Postgres, newest first. */
export async function playHistoryRows(userId: string) {
  const res = await admin(
    `/rest/v1/play_history?user_id=eq.${userId}&select=song_id,position_seconds,played_at&order=played_at.desc`
  )
  return (await res.json()) as {
    song_id: string
    position_seconds: number
    played_at: string
  }[]
}

/**
 * The player builds its element with `new Audio()`, which is never attached
 * to the document, so a test can't reach it by selector. This records every
 * instance as it's constructed, which is also how we observe playback without
 * adding test-only hooks to the app.
 */
async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const Native = window.Audio
    const seen: HTMLAudioElement[] = []
    ;(window as unknown as { __audios: HTMLAudioElement[] }).__audios = seen
    function Patched(this: unknown, ...args: unknown[]) {
      const el = new (Native as unknown as new (
        ...a: unknown[]
      ) => HTMLAudioElement)(...args)
      seen.push(el)
      return el
    }
    Patched.prototype = Native.prototype
    window.Audio = Patched as unknown as typeof Audio
  })
}

/** Resolves once audio is genuinely playing, not merely asked to play. */
export async function waitForPlaying(page: Page) {
  await page.waitForFunction(
    () => {
      const list =
        (window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? []
      return list.some((a) => !a.paused && a.currentTime > 0)
    },
    undefined,
    { timeout: 20_000 }
  )
}

/** Pauses playback, which is what makes the player save its resume point. */
export async function pauseAudio(page: Page) {
  await page.evaluate(() => {
    const list =
      (window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? []
    for (const a of list) a.pause()
  })
}

/**
 * Returns to Home the way a user does, through the app's own nav, so the
 * player survives and nothing reloads. page.goto('/') would be a full page
 * load and prove nothing about the rail updating without a refresh.
 */
export async function goHome(page: Page) {
  await page
    .getByRole('link', { name: 'Home', exact: true })
    .filter({ visible: true })
    .first()
    .click()
  await page.waitForURL((url) => url.pathname === '/')
}

/** The player's current position, in seconds. */
export async function audioTime(page: Page) {
  return page.evaluate(() => {
    const list =
      (window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? []
    return list.at(-1)?.currentTime ?? 0
  })
}

/** Jumps the player's audio to this position, like dragging the scrubber. */
export async function seekAudio(page: Page, seconds: number) {
  await page.evaluate((s) => {
    const list =
      (window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? []
    const a = list.at(-1)
    if (a) a.currentTime = s
  }, seconds)
}

/** A playlist's rows straight from Postgres, in stored position order. */
export async function playlistRows(playlistId: string) {
  const res = await admin(
    `/rest/v1/playlist_songs?playlist_id=eq.${playlistId}&select=song_id,position&order=position.asc`
  )
  return (await res.json()) as { song_id: string; position: number }[]
}

/** The playlists owned by a user, newest first. */
export async function playlistsOf(userId: string) {
  const res = await admin(
    `/rest/v1/playlists?user_id=eq.${userId}&select=id,title&order=created_at.desc`
  )
  return (await res.json()) as { id: string; title: string }[]
}


/* ------------------------------------------------------------ cover uploads */

function crc32(buf: Buffer) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * A real, decodable PNG, built here rather than committed as a fixture.
 *
 * Deliberately non-square so the upload path's centre crop actually has
 * something to do; a square fixture would pass even if cropping were broken.
 */
export function pngBytes(width = 40, height = 90, rgb: [number, number, number] = [140, 90, 240]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0 // no filter
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 3
      raw[at] = rgb[0]
      raw[at + 1] = rgb[1]
      raw[at + 2] = rgb[2]
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A real signed-in access token, for testing storage policies directly. */
export async function tokenFor(email: string) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  })
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`could not sign in as ${email}`)
  return body.access_token
}

/** Attempts a raw storage write, to prove the policy and not just the UI. */
export async function tryCoverUpload(
  token: string,
  path: string,
  bytes: Buffer
) {
  const res = await fetch(`${SB}/storage/v1/object/playlist-covers/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(bytes),
  })
  return { status: res.status, body: (await res.text()).slice(0, 160) }
}


/* --------------------------------------------------------------- settings */

/** Writes a review as the service role, for fixtures the test doesn't drive. */
export async function createReview(
  userId: string,
  songId: string,
  rating: number,
  body: string
) {
  const res = await admin('/rest/v1/reviews', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, song_id: songId, rating, body }),
  })
  const [row] = (await res.json()) as { id: string }[]
  return row.id
}

/**
 * `follower` follows `following`, as a fixture. The insert trigger picks the
 * status from the target's privacy, so an accepted follow onto a private
 * account needs the second write.
 */
export async function makeFollow(
  follower: string,
  following: string,
  status: 'accepted' | 'pending' = 'accepted'
) {
  const res = await admin('/rest/v1/user_follows', {
    method: 'POST',
    body: JSON.stringify({ follower_id: follower, following_id: following }),
  })
  if (!res.ok) throw new Error(`makeFollow failed: ${res.status} ${await res.text()}`)
  await admin(
    `/rest/v1/user_follows?follower_id=eq.${follower}&following_id=eq.${following}`,
    { method: 'PATCH', body: JSON.stringify({ status }) }
  )
}

/** The stored follow row, or null. Reads past RLS. */
export async function followRow(follower: string, following: string) {
  const rows = (await (
    await admin(
      `/rest/v1/user_follows?follower_id=eq.${follower}&following_id=eq.${following}&select=status`
    )
  ).json()) as { status: string }[]
  return rows[0]?.status ?? null
}

/** Flip an account's privacy as the service role. Fires the same triggers. */
export async function setPrivate(userId: string, isPrivate: boolean) {
  await admin(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_private: isPrivate }),
  })
}

/**
 * Likes a review as a real signed-in user, so the database trigger fires
 * with a genuine actor. Liking as the service role would bypass the very
 * path under test.
 */
export async function likeReviewAs(token: string, reviewId: string, userId: string) {
  return fetch(`${SB}/rest/v1/review_likes`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ review_id: reviewId, user_id: userId }),
  })
}

export async function notificationsOf(userId: string) {
  const res = await admin(
    `/rest/v1/notifications?user_id=eq.${userId}&select=type,payload`
  )
  return (await res.json()) as { type: string; payload: Record<string, unknown> }[]
}

/** The stored settings row, to prove a toggle actually persisted. */
export async function settingsOf(userId: string) {
  const profileBody = await (
    await admin(
      `/rest/v1/profiles?id=eq.${userId}&select=translation_language,is_private,friends_list_visible`
    )
  ).json()
  const prefsBody = await (
    await admin(`/rest/v1/notification_preferences?user_id=eq.${userId}&select=*`)
  ).json()

  // PostgREST answers with an error object, not an array, when a column or
  // table is missing. Say so plainly rather than failing on a destructure.
  if (!Array.isArray(profileBody) || !Array.isArray(prefsBody)) {
    throw new Error(
      'settings schema missing — apply 0021 and 0022: ' +
        JSON.stringify(Array.isArray(profileBody) ? prefsBody : profileBody)
    )
  }

  return {
    profile: profileBody[0] as {
      translation_language: string
      is_private: boolean
      friends_list_visible: boolean
    },
    prefs: (prefsBody[0] ?? null) as Record<string, boolean> | null,
  }
}

/** A song's average as the database sees it, ignoring RLS. */
export async function songRatingFacts(songId: string) {
  const rows = (await (
    await admin(`/rest/v1/reviews?song_id=eq.${songId}&select=rating`)
  ).json()) as { rating: number }[]
  const count = rows.length
  const avg = count ? rows.reduce((a, r) => a + r.rating, 0) / count : null
  return { count, avg }
}

/**
 * The mini player bar. A named region rather than the /now-playing link,
 * because the bar holds two of those now (the cover and the title) and the
 * cover has no text to assert against.
 */
export function miniPlayer(page: Page) {
  return page.getByRole('region', { name: 'Mini player' })
}

/* ------------------------------------------------- artist / album fixtures */

/** Marks every catalog row these tests create, so cleanup can find them. */
export const TEST_SPOTIFY_PREFIX = 'e2e-'

export type SeededTrack = {
  id: string
  title: string
  trackNumber: number
  discNumber: number
  artistName: string
}

export type SeededArtist = {
  id: string
  name: string
  albumId: string
  albumTitle: string
  tracks: SeededTrack[]
  featureArtistId: string
}

/**
 * Builds a complete artist, album and track list straight in the database.
 *
 * Deliberately not driven through Spotify: the pages read our own tables, so
 * seeding keeps these deterministic and off a rate-limited third party whose
 * catalog can change under us.
 */
export async function seedArtistWithAlbum(label: string): Promise<SeededArtist> {
  const stamp = `${TEST_SPOTIFY_PREFIX}${label}-${Date.now()}`

  const insert = async (path: string, body: unknown) => {
    const res = await admin(path, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    const parsed = await res.json()
    if (!Array.isArray(parsed)) {
      throw new Error(`seed failed on ${path}: ${JSON.stringify(parsed)}`)
    }
    return parsed
  }

  const [main] = (await insert('/rest/v1/artists', {
    spotify_id: `${stamp}-artist`,
    name: `Test Artist ${label}`,
  })) as { id: string }[]

  const [feature] = (await insert('/rest/v1/artists', {
    spotify_id: `${stamp}-feature`,
    name: `Guest ${label}`,
  })) as { id: string }[]

  const [album] = (await insert('/rest/v1/albums', {
    spotify_id: `${stamp}-album`,
    title: `Album ${label}`,
    artist_id: main.id,
    release_date: '2020-05-01',
    total_tracks: 3,
    album_type: 'album',
  })) as { id: string }[]

  // Track three is by the guest and on disc two, so the album page has both
  // a feature to name and a disc divider to draw.
  const spec = [
    { n: 1, d: 1, title: `One ${label}`, artist: main.id, artistName: `Test Artist ${label}` },
    { n: 2, d: 1, title: `Two ${label}`, artist: main.id, artistName: `Test Artist ${label}` },
    { n: 3, d: 2, title: `Three ${label}`, artist: feature.id, artistName: `Guest ${label}` },
  ]

  const rows = (await insert(
    '/rest/v1/songs',
    spec.map((t) => ({
      spotify_id: `${stamp}-track-${t.n}`,
      title: t.title,
      artist_id: t.artist,
      album_id: album.id,
      duration_ms: 180000,
      track_number: t.n,
      disc_number: t.d,
      popularity: 1000 - t.n,
    }))
  )) as { id: string; title: string }[]

  const byTitle = new Map(rows.map((r) => [r.title, r.id]))

  return {
    id: main.id,
    name: `Test Artist ${label}`,
    albumId: album.id,
    albumTitle: `Album ${label}`,
    featureArtistId: feature.id,
    tracks: spec.map((t) => ({
      id: byTitle.get(t.title)!,
      title: t.title,
      trackNumber: t.n,
      discNumber: t.d,
      artistName: t.artistName,
    })),
  }
}

/** Removes every catalog row these tests created. */
export async function deleteSeededCatalog() {
  await admin(`/rest/v1/songs?spotify_id=like.${TEST_SPOTIFY_PREFIX}*`, { method: 'DELETE' })
  await admin(`/rest/v1/albums?spotify_id=like.${TEST_SPOTIFY_PREFIX}*`, { method: 'DELETE' })
  await admin(`/rest/v1/artists?spotify_id=like.${TEST_SPOTIFY_PREFIX}*`, { method: 'DELETE' })
}

/** An album dated today, the way a genuinely new release looks. */
export async function seedNewRelease(artistId: string, label: string) {
  const res = await admin('/rest/v1/albums', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      spotify_id: `${TEST_SPOTIFY_PREFIX}${label}-new-${Date.now()}`,
      title: `Brand New ${label}`,
      artist_id: artistId,
      release_date: new Date().toISOString().slice(0, 10),
      total_tracks: 1,
      album_type: 'album',
    }),
  })
  const [album] = (await res.json()) as { id: string; title: string }[]
  return album
}

/** Runs the database fan-out the Edge Function calls after a sync. */
export async function fanOutRelease(artistId: string, albumId: string) {
  const res = await admin('/rest/v1/rpc/notify_artist_release', {
    method: 'POST',
    body: JSON.stringify({ target_artist: artistId, target_album: albumId }),
  })
  const text = await res.text()
  return { status: res.status, sent: Number(text) }
}

export async function followArtistAs(userId: string, artistId: string) {
  await admin('/rest/v1/follows', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, artist_id: artistId }),
  })
}
