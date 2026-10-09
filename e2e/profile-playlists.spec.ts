import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createPlaylistWithSongs,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  logout,
  makeFollow,
  type PlayableSong,
} from './helpers'

/**
 * The full playlists list, reached from the profile. Mirrors how the
 * followers, artists and reviews lists already behave.
 */
test.describe('profile playlists list', () => {
  let owner: { id: string; email: string }
  let follower: { id: string; email: string }
  let stranger: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    owner = await createTestUser('pp-owner')
    follower = await createTestUser('pp-follower')
    stranger = await createTestUser('pp-stranger')
    songs = await distinctSongs(3)
    await makeFollow(follower.id, owner.id)

    // Enough to trip the preview cap, with titles and sizes that make each
    // sort order distinguishable.
    await createPlaylistWithSongs(owner.id, 'Zebra Nights', [songs[0].id])
    await createPlaylistWithSongs(owner.id, 'Morning Coffee', [
      songs[0].id,
      songs[1].id,
      songs[2].id,
    ])
    for (let i = 1; i <= 5; i++) {
      await createPlaylistWithSongs(owner.id, `Filler ${i}`, [])
    }
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  const cardTitles = (page: Page) =>
    page.locator('a[href^="/playlist/"] .text-card-title').allInnerTexts()

  test('the stat card and See all both open the full page', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}`)

    // Seven playlists, so the tab previews six and offers the rest.
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect.poll(async () => (await cardTitles(page)).length).toBe(6)

    await page.getByRole('link', { name: /See all \(7\)/ }).click()
    await page.waitForURL(/\/profile\/.*\/playlists/)
    await expect(page.getByRole('heading', { name: 'Your playlists' })).toBeVisible()
    await expect.poll(async () => (await cardTitles(page)).length).toBe(7)

    // And the stat card is the other way in.
    await page.goto(`/profile/${owner.id}`)
    await page.getByRole('link', { name: /Playlists 7/ }).click()
    await page.waitForURL(/\/profile\/.*\/playlists/)
    await expect(page.getByRole('heading', { name: 'Your playlists' })).toBeVisible()
  })

  test('search filters, and each sort order works', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    await expect.poll(async () => (await cardTitles(page)).length).toBe(7)

    // Search.
    // FilterBox renders <input type="search">, so the role is searchbox.
    await page.getByRole('searchbox', { name: /filter/i }).fill('coffee')
    await expect.poll(() => cardTitles(page)).toEqual(['Morning Coffee'])
    await page.getByRole('searchbox', { name: /filter/i }).fill('')

    // A–Z.
    await page.getByRole('button', { name: 'A–Z' }).click()
    await expect
      .poll(async () => (await cardTitles(page))[0])
      .toBe('Filler 1')
    await expect
      .poll(async () => (await cardTitles(page)).at(-1))
      .toBe('Zebra Nights')

    // Most songs: the three-song playlist first, the one-song next.
    await page.getByRole('button', { name: 'Most songs' }).click()
    await expect
      .poll(async () => (await cardTitles(page)).slice(0, 2))
      .toEqual(['Morning Coffee', 'Zebra Nights'])

    // Recently updated is the default, newest first.
    await page.getByRole('button', { name: 'Recently updated' }).click()
    await expect
      .poll(async () => (await cardTitles(page))[0])
      .toBe('Filler 5')
  })

  test('New playlist shows only on your own list', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    await expect(page.getByRole('button', { name: /new playlist/i })).toBeVisible()

    await logout(page)
    await login(page, stranger.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    await expect(page.getByRole('heading', { name: /playlists/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /new playlist/i })).toHaveCount(0)
  })

  test('a private account shows the message to a non-follower and the list to a follower', async ({
    page,
  }) => {
    await adminFetch(`/rest/v1/profiles?id=eq.${owner.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_private: true }),
    })

    await login(page, stranger.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    await expect(page.getByText('This account is private.')).toBeVisible()
    await expect(page.locator('a[href^="/playlist/"]')).toHaveCount(0)

    // The stat card is still there with its number, but isn't a link.
    await page.goto(`/profile/${owner.id}`)
    // Scoped to the stats list: 'Playlists' is also the tab chip's label.
    await expect(page.locator('dl').getByText('Playlists', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Playlists \d+/ })).toHaveCount(0)

    // An accepted follower sees the real list.
    await logout(page)
    await login(page, follower.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    await expect(page.getByText('This account is private.')).toHaveCount(0)
    await expect.poll(async () => (await cardTitles(page)).length).toBe(7)

    await adminFetch(`/rest/v1/profiles?id=eq.${owner.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_private: false }),
    })
  })
})
