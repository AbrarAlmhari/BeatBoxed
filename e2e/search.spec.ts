import { test, expect, type Page } from '@playwright/test'
import { createTestUser, deleteTestUsers, login } from './helpers'

/**
 * Searching by title and artist together, in any order.
 *
 * These run against the real catalog rather than fixtures: the songs are
 * already cached, and the point of the change is how a real multi-word query
 * behaves against real rows.
 */
test.describe('song search', () => {
  let user: { id: string; email: string }

  test.beforeAll(async () => {
    user = await createTestUser('search')
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  /** Types into Explore's search box and returns the song titles in order. */
  async function search(page: Page, query: string) {
    await page.goto('/explore')
    const box = page.getByRole('searchbox').first()
    await box.fill(query)
    // The box is debounced, so wait for results to settle rather than
    // reading whatever is on screen from the previous keystroke.
    await expect
      .poll(
        async () =>
          page.locator('a[href^="/song/"] .text-card-title').count(),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0)
    return page.locator('a[href^="/song/"] .text-card-title').allInnerTexts()
  }

  test('finds a song from its title and artist in either order', async ({ page }) => {
    await login(page, user.email)

    /*
     * startsWith, not equals: the catalog holds both "Karma Police" and
     * "Karma Police - Remastered", and neither title equals the typed query,
     * so both land in the same rank group and popularity decides between
     * them. Which pressing comes first isn't what this test is about —
     * that the song is found at all, from either word order, is.
     */
    const forwards = await search(page, 'karma police radiohead')
    expect(forwards[0]).toMatch(/^Karma Police/)

    const backwards = await search(page, 'radiohead karma police')
    expect(backwards[0]).toMatch(/^Karma Police/)
  })

  test('ignores punctuation, so "gods plan" finds God’s Plan', async ({ page }) => {
    await login(page, user.email)
    const titles = await search(page, 'gods plan')
    expect(titles[0]).toBe("God's Plan")
  })

  test('matches partial words while typing', async ({ page }) => {
    await login(page, user.email)

    // Half a title, then half a title plus half an artist.
    expect(await search(page, 'karma pol')).toContain('Karma Police')
    expect(await search(page, 'karma pol radio')).toContain('Karma Police')
  })

  test('a single artist name still returns their songs', async ({ page }) => {
    await login(page, user.email)
    const titles = await search(page, 'radiohead')
    expect(titles.length).toBeGreaterThan(0)

    /*
     * Asserts whose songs came back rather than which ones. Results are
     * ordered by popularity and capped, so naming a specific track makes
     * the test depend on the catalog's current ranking — it broke once
     * already when a remaster outranked the original.
     */
    const subtitles = await page
      .locator('a[href^="/song/"] .text-muted-foreground')
      .allInnerTexts()
    expect(subtitles.filter((s) => /radiohead/i.test(s)).length).toBeGreaterThan(0)
  })
})
