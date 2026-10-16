import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  logout,
  env,
  makeFollow,
  setPrivate,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * The profile's Stats tab (Part B): get_user_stats() for a time range,
 * the warm-up state under 5 ratings, privacy, and Share.
 */

type User = { id: string; email: string }

/** Ratings with no text, optionally dated in the past. */
async function rate(userId: string, songs: PlayableSong[], ratings: number[], createdAt?: string) {
  await adminFetch('/rest/v1/reviews', {
    method: 'POST',
    body: JSON.stringify(
      songs.map((s, i) => ({
        user_id: userId,
        song_id: s.id,
        rating: ratings[i],
        ...(createdAt ? { created_at: createdAt, updated_at: createdAt } : {}),
      }))
    ),
  })
}

/** get_user_stats() called directly as a signed-in user. */
async function statsAs(email: string, ownerId: string) {
  const token = await tokenFor(email)
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/get_user_stats`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_user_id: ownerId, p_range: 'all' }),
  })
  return (await res.json()) as { total: number } | null
}

const tile = (page: Page, label: string) =>
  page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')

test.describe('profile stats', () => {
  let rater: User
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    songs = await distinctSongs(9)
    rater = await createTestUser('stats-rater')
    // Six this month, three from two years ago.
    await rate(rater.id, songs.slice(0, 6), [5, 4, 4, 3, 5, 2])
    const old = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString()
    await rate(rater.id, songs.slice(6, 9), [1, 1, 3], old)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('the stats show, and the range changes the numbers', async ({ page }) => {
    await login(page, rater.email)
    await page.goto(`/profile/${rater.id}?tab=stats`)

    await expect(tile(page, 'Songs rated')).toHaveText('9')
    await expect(page.getByText("Beatie's take")).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ratings spread' })).toBeVisible()
    await expect(page.getByText('9 ratings · average 3.1★')).toBeVisible()
    // Every bar is a labelled button with its number.
    await expect(page.getByRole('button', { name: '1 star: 2 songs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Most rated artists' })).toBeVisible()

    // The last 30 days leave out the three old ratings.
    await page.getByRole('button', { name: '30 days', exact: true }).click()
    await expect(page.getByRole('button', { name: '30 days', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(page, 'Songs rated')).toHaveText('6')
    await expect(page.getByRole('button', { name: '1 star: 0 songs' })).toBeVisible()

    // A bar's tooltip on tap.
    await page.getByRole('button', { name: /^5 stars:/ }).click()
    await expect(page.getByRole('status').filter({ hasText: '5★ · 2 songs' })).toBeVisible()

    // Back to all time is instant: the first answer was kept.
    await page.getByRole('button', { name: 'All time', exact: true }).click()
    await expect(tile(page, 'Songs rated')).toHaveText('9')
  })

  test('under 5 ratings: the warm-up state, with a way to rate more on your own profile', async ({ page }) => {
    const few = await createTestUser('stats-few')
    await rate(few.id, songs.slice(0, 2), [4, 5])

    await login(page, few.email)
    await page.goto(`/profile/${few.id}?tab=stats`)
    await expect(page.getByText('Your stats are warming up')).toBeVisible()
    await expect(page.getByText('Rate 3 more songs')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: '2 of 5 ratings' })).toBeVisible()
    await page.getByRole('link', { name: 'Find songs to rate' }).click()
    await expect(page).toHaveURL(/\/explore/)

    // Someone else's: a plain line, no button.
    const [{ username }] = (await (
      await adminFetch(`/rest/v1/profiles?id=eq.${few.id}&select=username`)
    ).json()) as { username: string }[]
    await logout(page)
    await login(page, rater.email)
    await page.goto(`/profile/${few.id}?tab=stats`)
    await expect(page.getByText(`@${username} needs a few more ratings before their stats show up.`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Find songs to rate' })).toHaveCount(0)
  })

  test("a private account's stats stay hidden from non-followers", async ({ page }) => {
    const priv = await createTestUser('stats-private')
    await rate(priv.id, songs.slice(0, 5), [5, 5, 4, 4, 3])
    await setPrivate(priv.id, true)
    const follower = await createTestUser('stats-follower')
    await makeFollow(follower.id, priv.id)

    // A stranger gets the lock card, no tabs, no numbers.
    await login(page, rater.email)
    await page.goto(`/profile/${priv.id}?tab=stats`)
    await expect(page.getByText('This account is private.', { exact: false }).first()).toBeVisible()
    await expect(page.getByText("Beatie's take")).toHaveCount(0)

    // And the database itself refuses: the function returns nothing.
    const asStranger = await statsAs(rater.email, priv.id)
    expect(asStranger).toBeNull()

    // An approved follower sees them.
    await logout(page)
    await login(page, follower.email)
    await page.goto(`/profile/${priv.id}?tab=stats`)
    await expect(tile(page, 'Songs rated')).toHaveText('5')
  })

  test('Share copies a link to the Stats tab', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await login(page, rater.email)
    await page.goto(`/profile/${rater.id}?tab=stats`)
    await page.getByRole('button', { name: 'Share my stats' }).click()
    await expect(page.getByText('Link copied')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toMatch(new RegExp(`/profile/${rater.id}\\?tab=stats$`))
  })
})
