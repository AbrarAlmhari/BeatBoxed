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
