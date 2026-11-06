import { test, expect, type Page } from './fixtures'
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

/** The type button beside the search box ("All ⌄"), shown only with a search. */
const filters = (page: Page) => page.getByRole('button', { name: /^Filter results/ })
const typeSheet = (page: Page) => page.getByRole('dialog', { name: 'Filter results' })

/** Opens the type sheet and taps a type; the sheet closes on the tap. */
async function pickType(page: Page, label: string) {
  await filters(page).click()
  await typeSheet(page).getByRole('radio', { name: label, exact: true }).click()
  await expect(typeSheet(page)).toHaveCount(0)
}

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
    await pickType(page, 'Artists')
    await expect(page).toHaveURL(/filter=artists/)

    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(filters(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/filter=|q=/)
    await expect(page.getByRole('list', { name: 'Trending' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'For You' })).toBeVisible()

    // Typing again starts from All.
    await page.getByRole('searchbox', { name: 'Search' }).fill('radiohead')
    await expect(filters(page)).toHaveAccessibleName('Filter results: All')

    // Deleting the text by hand works the same as Clear.
    await page.getByRole('searchbox', { name: 'Search' }).fill('')
    await expect(filters(page)).toHaveCount(0)
  })

  test('a search in the address shows them straight away', async ({ page }) => {
    await login(page, user.email)
    await page.goto('/explore?q=radiohead')
    await expect(filters(page)).toBeVisible()
  })

  test('switching types many times in a row: results follow, and the page keeps scrolling', async ({ page }, info) => {
    test.setTimeout(180_000)
    await login(page, user.email)
    // Short, so every result list is taller than the screen.
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 480 })
    await page.goto('/explore?q=love')
    await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible()

    const sections = ['Songs', 'Artists', 'People', 'Lyrics']
    const types = ['Songs', 'Artists', 'All', 'Lyrics', 'People', 'Songs', 'All', 'Artists', 'Lyrics', 'All']
    for (const type of [...types, ...types]) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await pickType(page, type)
      await expect(filters(page)).toHaveAccessibleName(`Filter results: ${type}`)
      if (type === 'All') {
        await expect(page).not.toHaveURL(/filter=/)
        await expect(page.getByRole('heading', { name: /^Songs/ })).toBeVisible()
      } else {
        await expect(page).toHaveURL(new RegExp(`filter=${type.toLowerCase()}`))
        for (const other of sections.filter((s) => s !== type)) {
          await expect(page.getByRole('heading', { name: new RegExp(`^${other}`) })).toHaveCount(0)
        }
      }

      // The sheet let go of the page, and a finger or wheel still scrolls it.
      expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe('hidden')
      const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40)
      if (!tall) continue
      if (info.project.name === 'mobile') {
        const cdp = await page.context().newCDPSession(page)
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y = 380) =>
          cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] })
        await touch('touchStart')
        for (let i = 1; i <= 10; i++) await touch('touchMove', 380 - i * 25)
        await touch('touchEnd')
        await cdp.detach()
      } else {
        await page.mouse.move(400, 380)
        await page.mouse.wheel(0, 300)
      }
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    }
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

test.describe('a slow Spotify', () => {
  test('never holds up results: the catalogue answer shows, with a note', async ({ page }) => {
    // Spotify is only asked when the catalogue has few matches; make it hang.
    await page.route('**/functions/v1/spotify-search', () => new Promise(() => {}))
    await login(page, user.email)
    await page.goto('/explore')
    await page.getByRole('searchbox', { name: 'Search' }).fill('karma police radiohead')
    const main = page.getByRole('main')
    await expect(main.getByText(/^Karma Police/).first()).toBeVisible({ timeout: 20_000 })
    await expect(main.getByText('Spotify search is unavailable right now, showing saved results.')).toBeVisible()
  })
})
