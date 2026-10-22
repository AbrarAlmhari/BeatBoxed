import { test, expect, type Page } from '@playwright/test'
import { createTestUser, deleteTestUsers, login } from './helpers'

/**
 * Explore: the search filters appear only with a search, and a track is
 * listed once in any rail or search result, even when the catalogue holds
 * several copies of it (one per release).
 */

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`explore-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

const filters = (page: Page) => page.getByRole('group', { name: 'Filter results' })

/** Title + artist of each card in a list, as shown. */
async function tracks(list: ReturnType<Page['getByRole']>) {
  return list.getByRole('listitem').evaluateAll((items) =>
    items.map((li) => (li as HTMLElement).innerText.split('\n').slice(0, 2).join(' | ').toLowerCase().trim())
  )
}

test.describe('search filters', () => {
  test('hidden on an empty Explore, shown after typing, hidden and reset by clearing', async ({ page }) => {
    await login(page, user.email)
    await page.goto('/explore')
    await expect(page.getByRole('list', { name: 'Trending' })).toBeVisible()
    await expect(filters(page)).toHaveCount(0)

    await page.getByRole('searchbox', { name: 'Search' }).fill('radiohead')
    await expect(filters(page)).toBeVisible()
    await filters(page).getByRole('button', { name: 'Artists' }).click()
    await expect(page).toHaveURL(/filter=artists/)

    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(filters(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/filter=|q=/)
    await expect(page.getByRole('list', { name: 'Trending' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'For You' })).toBeVisible()

    // Typing again starts from All.
    await page.getByRole('searchbox', { name: 'Search' }).fill('radiohead')
    await expect(filters(page).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    // Deleting the text by hand works the same as Clear.
    await page.getByRole('searchbox', { name: 'Search' }).fill('')
    await expect(filters(page)).toHaveCount(0)
  })

  test('a search in the address shows them straight away', async ({ page }) => {
    await login(page, user.email)
    await page.goto('/explore?q=radiohead')
    await expect(filters(page)).toBeVisible()
  })
})

test.describe('no track twice', () => {
  test('Trending, For You and the full Trending list list each track once', async ({ page }) => {
    await login(page, user.email)
    await page.goto('/explore')
    for (const name of ['Trending', 'For You']) {
      const list = page.getByRole('list', { name })
      await expect(list.getByRole('link').first()).toBeVisible()
      const shown = await tracks(list)
      expect(new Set(shown).size, `${name}: ${shown.join(', ')}`).toBe(shown.length)
    }

    await page.goto('/explore/trending')
    await expect(page.getByRole('link').nth(10)).toBeVisible()
    const titles = await page.locator('main li').evaluateAll((items) =>
      items.map((li) => (li as HTMLElement).innerText.split('\n').slice(0, 2).join(' | ').toLowerCase().trim())
    )
    expect(new Set(titles).size).toBe(titles.length)
  })

  test("search results list a track once (Can't Hold Us has two copies in the catalogue)", async ({ page }) => {
    await login(page, user.email)
    await page.goto(`/explore?q=${encodeURIComponent("can't hold us")}&filter=songs`)
    const songs = page.getByRole('main').getByRole('link', { name: /Can.t Hold Us/i })
    await expect(songs.first()).toBeVisible()
    const hrefs = await songs.evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href')))])
    const labels = await songs.evaluateAll((links) =>
      links.filter((a) => /macklemore/i.test((a.closest('li') as HTMLElement | null)?.innerText ?? (a as HTMLElement).innerText)).map((a) => a.getAttribute('href'))
    )
    expect(new Set(labels).size, `song links: ${hrefs.join(', ')}`).toBeLessThanOrEqual(1)
  })
})
