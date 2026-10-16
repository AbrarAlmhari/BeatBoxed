import { test, expect } from '@playwright/test'
import { adminFetch, createTestUser, deleteTestUsers, distinctSongs, login, rail, railSongIds } from './helpers'

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

  test("See all opens each full list, which starts with the rail's songs in order", async ({ page }) => {
    const me = await createTestUser('ex-seeall')
    // Some history, so Recently viewed shows.
    const viewed = await distinctSongs(3)
    await adminFetch('/rest/v1/song_views', {
      method: 'POST',
      body: JSON.stringify(
        viewed.map((s, i) => ({ user_id: me.id, song_id: s.id, viewed_at: new Date(Date.now() - i * 60_000).toISOString() }))
      ),
    })
    await login(page, me.email)

    const listIds = async () =>
      page
        .getByRole('list', { name: /Trending|For You|Recently viewed/ })
        .locator('a[href^="/song/"]')
        .evaluateAll((els) => els.map((a) => a.getAttribute('href')!.split('/song/')[1]))

    for (const [title, path] of [
      ['Trending', '/explore/trending'],
      ['For You', '/explore/for-you'],
      ['Recently viewed', '/explore/recent'],
    ] as const) {
      await page.goto('/explore')
      await expect(rail(page, title).locator('a[href^="/song/"]').first()).toBeVisible()
      const onRail = await railSongIds(page, title)
      await rail(page, title).getByRole('link', { name: 'See all' }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect.poll(async () => (await listIds()).length).toBeGreaterThanOrEqual(onRail.length)
      expect((await listIds()).slice(0, onRail.length)).toEqual(onRail)
    }

    // Recently viewed in full: exactly the three songs, newest first.
    expect(await listIds()).toEqual(viewed.map((s) => s.id))

    // Trending pages in 20s as you scroll, without repeats.
    await page.goto('/explore/trending')
    await expect.poll(async () => (await listIds()).length).toBe(20)
    await page.mouse.wheel(0, 20000)
    await expect.poll(async () => (await listIds()).length).toBeGreaterThan(20)
    const all = await listIds()
    expect(new Set(all).size).toBe(all.length)

    // A row opens its song page.
    await page.locator('a[href^="/song/"]').first().click()
    await expect(page).toHaveURL(/\/song\//)
  })

  test('one dropped request does not blank the rails', async ({ page }) => {
    const me = await createTestUser('ex-flaky')
    await login(page, me.email)

    // The first Trending request fails; the retry and the other rails carry on.
    let dropped = false
    await page.route(/\/rest\/v1\/songs\?select=.*order=popularity\.desc\.nullslast%2Ccached_at\.desc/, (route) => {
      if (dropped) return route.continue()
      dropped = true
      return route.abort('failed')
    })

    await page.goto('/explore')
    await expect(rail(page, 'Trending').locator('a[href^="/song/"]').first()).toBeVisible()
    await expect(rail(page, 'For You').locator('a[href^="/song/"]').first()).toBeVisible()
    await expect(page.getByText("Couldn't load songs to browse.")).toHaveCount(0)
    expect(dropped).toBe(true)
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
