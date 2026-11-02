import { test, expect, type Locator, type Page } from '@playwright/test'
import { adminFetch, createTestUser, deleteTestUsers, login } from './helpers'

/**
 * Strip bars on a phone: the ones that fit don't move when swiped sideways,
 * a vertical swipe that starts on one still scrolls the page, and they stay
 * just under the top bar, on a solid background, as the page scrolls.
 */

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`strips-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'mobile', 'Touch swipes on a phone')
})

/** A finger swipe: down on the element, ten small moves, up. */
async function swipe(page: Page, on: Locator, dx: number, dy: number) {
  const box = (await on.boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px = x, py = y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] })
  await touch('touchStart')
  for (let i = 1; i <= 10; i++) await touch('touchMove', x + (dx * i) / 10, y + (dy * i) / 10)
  await touch('touchEnd')
  await cdp.detach()
  // Let any fling or bounce settle before measuring.
  await page.waitForTimeout(400)
}

/** Where the bar sits, and how far anything inside it has scrolled. */
const place = (bar: Locator) =>
  bar.evaluate((el) => ({
    left: Math.round(el.getBoundingClientRect().left),
    shifted: [el, ...el.querySelectorAll('*')].some((n) => n.scrollLeft !== 0),
    pageX: window.scrollX,
  }))

/** Bottom of the app's top bar (0 where it's hidden). */
const topBarBottom = (page: Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0)

/** Room to scroll, inside the column the bar sticks within. */
const lengthen = (bar: Locator) =>
  bar.evaluate((el) => {
    const spacer = document.createElement('div')
    spacer.style.height = '2400px'
    el.parentElement!.append(spacer)
  })

async function expectDockedAndSolid(page: Page, bar: Locator) {
  const header = await topBarBottom(page)
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y - header)).toBe(0)
  await expect(bar).toBeInViewport()
  const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)|transparent/)
}

test('song page: all four tabs share the width and the bar never moves sideways', async ({ page }) => {
  const [song] = (await (
    await adminFetch('/rest/v1/songs?select=id&artist_id=not.is.null&order=popularity.desc.nullslast&limit=1')
  ).json()) as { id: string }[]
  await login(page, user.email)
  await page.goto(`/song/${song.id}`)
  const bar = page.getByRole('navigation', { name: 'Jump to section' })
  const tabs = bar.getByRole('button')
  await expect(tabs).toHaveText(['About', 'Beatie', 'Lyrics', 'Reviews'])

  const widths = await tabs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThan(1)
  for (const t of await tabs.all()) await expect(t).toBeInViewport({ ratio: 1 })

  const before = await place(bar)
  await swipe(page, bar, -250, 0)
  await swipe(page, bar, 250, 0)
  expect(await place(bar)).toEqual(before)
  expect(before.shifted).toBe(false)

  // An upward swipe that starts on the bar still scrolls the page.
  await swipe(page, bar, 0, -400)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expectDockedAndSolid(page, bar)
  expect(await place(bar)).toEqual(before)
})

test('explore: the search filters fit, stay still, and dock under the top bar', async ({ page }) => {
  await login(page, user.email)
  await page.goto('/explore?q=love')
  const chips = page.getByRole('group', { name: 'Filter results' })
  await expect(chips.getByRole('button', { name: 'Lyrics' })).toBeInViewport({ ratio: 1 })
  const bar = chips.locator('xpath=ancestor::div[contains(@class,"sticky")][1]')

  const before = await place(bar)
  await swipe(page, chips, -250, 0)
  expect(await place(bar)).toEqual(before)

  await lengthen(bar)
  await page.evaluate(() => window.scrollTo(0, 1200))
  await expectDockedAndSolid(page, bar)
})
