import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUsers, login, rail } from './helpers'

/**
 * Explore's browse view took over the song rails when Home became the review
 * feed, and lost the genre features (only seeded songs carry a genre, so
 * they showed a partial picture). Recently viewed has its own spec,
 * play-history.spec.ts, covering opened and played songs together.
 */
test.describe('explore rails', () => {
  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('the rails moved from Home to Explore', async ({ page }) => {
    const me = await createTestUser('ex-rails')
    await login(page, me.email)

    await page.goto('/explore')
    await expect(rail(page, 'Trending')).toBeVisible()
    await expect(rail(page, 'For You')).toBeVisible()
    await expect(rail(page, 'Trending').locator('a[href^="/song/"]').first()).toBeVisible()

    // Home is the feed now: tabs and the composer, no song rails.
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'For You' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Following' })).toBeVisible()
    await expect(page.getByRole('button', { name: /what song is on your mind/i })).toBeVisible()
    await expect(rail(page, 'Trending')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Continue Listening' })).toHaveCount(0)
  })

  test('the genre tiles and genre chips are gone', async ({ page }) => {
    const me = await createTestUser('ex-genres')
    await login(page, me.email)

    await page.goto('/explore')
    await expect(rail(page, 'Trending')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Browse by genre' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Filter by genre' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'All genres' })).toHaveCount(0)

    // Not while searching either, and an old ?genre= link is ignored.
    await page.goto('/explore?q=love&genre=pop')
    await expect(page.getByRole('heading', { name: /^Songs/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('group', { name: 'Filter by genre' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'All genres' })).toHaveCount(0)
  })
})
