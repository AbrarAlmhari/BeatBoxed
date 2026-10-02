import { readFileSync } from 'node:fs'
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
  await page.goto('/profile')
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
export async function stubPreviewAudio(page: Page, songs: PlayableSong[]) {
  const wav = silentWav(30)
  await installAudioProbe(page)

  await page.route(/itunes\.apple\.com/, async (route) => {
    const url = new URL(route.request().url())
    const term = (url.searchParams.get('term') ?? '').toLowerCase()
    const song =
      songs.find((s) => term.includes(s.title.toLowerCase())) ?? songs[0]
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
