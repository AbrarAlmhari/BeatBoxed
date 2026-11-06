import { test, expect, type Page } from '@playwright/test'
import {
  chooseFilter,
  createPlaylistWithSongs,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  filterSheet,
  login,
} from './helpers'

/**
 * The full reviews and playlists pages sort with the shared filter button:
 * its face says the current order ("Newest ⌄"), the sheet has one "Sort by"
 * list, and the old row of sort chips is gone.
 */
test.describe('sort buttons', () => {
  let owner: { id: string; email: string }

  test.beforeAll(async () => {
    owner = await createTestUser('sort-owner')
    const songs = await distinctSongs(3)
    // Posted in this order, so newest, highest and lowest each lead with a different one.
    await createReview(owner.id, songs[0].id, 5, 'Top: the chorus lifts the whole room every time.')
    await createReview(owner.id, songs[1].id, 1, 'Bottom: never quite found its footing for me.')
    await createReview(owner.id, songs[2].id, 3, 'Middle: a good verse, a forgettable hook overall.')
  })

  test.afterAll(async () => {
    await deleteTestUsers(owner.email)
  })

  const firstReview = (page: Page) =>
    page
      .getByRole('main')
      .locator('a[href^="/song/"]')
      .first()
      .innerText()
      .then((t) => t.match(/(Top|Bottom|Middle):/)?.[1] ?? t)

  test('reviews page: one button, Newest first, and each order works', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/reviews`)
    const button = page.getByRole('button', { name: 'Sort reviews: Newest' })
    await expect(button).toBeVisible()
    await expect(button).toHaveText('Newest')
    await expect(page.getByRole('group', { name: 'Sort reviews' })).toHaveCount(0)
    await expect.poll(() => firstReview(page)).toBe('Middle')

    await button.click()
    const sheet = filterSheet(page, 'Sort reviews')
    await expect(sheet.getByRole('radiogroup')).toHaveCount(1)
    await expect(sheet.getByRole('radiogroup', { name: 'Sort by' })).toBeVisible()
    await expect(sheet.getByRole('radio')).toHaveText(['Newest', 'Highest rated', 'Lowest rated'])
    await expect(sheet.getByRole('radio', { name: 'Newest' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    await chooseFilter(page, 'Sort reviews', 'Highest rated')
    await expect(page.getByRole('button', { name: 'Sort reviews: Highest rated' })).toBeVisible()
    await expect.poll(() => firstReview(page)).toBe('Top')

    await chooseFilter(page, 'Sort reviews', 'Lowest rated')
    await expect.poll(() => firstReview(page)).toBe('Bottom')

    await chooseFilter(page, 'Sort reviews', 'Newest')
    await expect.poll(() => firstReview(page)).toBe('Middle')
  })

  test('playlists page: the sort button sits beside the filter box, the same height', async ({ page }) => {
    await createPlaylistWithSongs(owner.id, 'Beside the filter', [])
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    const box = page.getByRole('searchbox', { name: 'Filter by title' })
    const button = page.getByRole('button', { name: 'Sort playlists: Newest' })
    await expect(box).toBeVisible()
    await expect(button).toBeVisible()
    const a = (await box.boundingBox())!
    const b = (await button.boundingBox())!
    expect(b.y).toBeCloseTo(a.y, 0)
    expect(b.height).toBeCloseTo(a.height, 0)
    expect(b.x).toBeGreaterThan(a.x + a.width - 1)
    const inner = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(inner).toBe(true)
  })

  test('playlists page: one button with Newest, A–Z and Most songs', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/playlists`)
    const button = page.getByRole('button', { name: 'Sort playlists: Newest' })
    await expect(button).toBeVisible()
    await expect(page.getByRole('group', { name: 'Sort playlists' })).toHaveCount(0)
    await button.click()
    const sheet = filterSheet(page, 'Sort playlists')
    await expect(sheet.getByRole('radiogroup')).toHaveCount(1)
    await expect(sheet.getByRole('radio')).toHaveText(['Newest', 'A–Z', 'Most songs'])
    await expect(sheet.getByRole('radio', { name: 'Newest' })).toHaveAttribute('aria-checked', 'true')
  })
})
