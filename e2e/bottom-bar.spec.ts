import { test, expect, type Page } from './fixtures'
import { createTestUser, deleteTestUsers, login } from './helpers'

/**
 * The phone's bottom bar: pinned to the bottom edge on every main page,
 * even scrolled all the way down, with nothing drawn over it; and the
 * Create and mood sheets open above it.
 */
test.describe('bottom bar (phone)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, 'phones only')

  let email: string
  test.beforeAll(async () => {
    email = (await createTestUser('bottom-bar')).email
  })
  test.afterAll(async () => {
    await deleteTestUsers(email)
  })

  const bar = (page: Page) => page.locator('nav[aria-label="Primary"]')

  async function checkPinned(page: Page) {
    const r = await bar(page).evaluate((nav) => {
      const box = nav.getBoundingClientRect()
      const style = getComputedStyle(nav)
      // What's drawn at a few points along the bar: the bar itself, or
      // something on top of it.
      const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => f * innerWidth)
      const covered = xs.filter((x) => {
        const hit = document.elementFromPoint(x, box.top + box.height / 2)
        return !hit || !nav.contains(hit)
      }).length
      return { bottom: box.bottom, vh: innerHeight, covered, bg: style.backgroundColor, h: box.height }
    })
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(1)
    expect(r.covered).toBe(0)
    // Solid: no see-through background.
    expect(r.bg).toBe('rgb(13, 13, 18)')
    expect(r.h).toBeGreaterThanOrEqual(60)
  }

  test('pinned to the bottom with nothing over it, scrolled to the end of each main page', async ({ page }) => {
    await login(page, email)
    for (const path of ['/', '/explore', '/library', '/profile']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(400)
      await checkPinned(page)
    }
  })

  test('the Create sheet and the mood sheet open above the bar', async ({ page }) => {
    await login(page, email)
    await page.goto('/')

    await page.getByRole('button', { name: 'Create', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Create' })
    await expect(create).toBeVisible()
    await expect(create.getByRole('button', { name: /Write a review/ })).toBeVisible()
    await expect(create.getByRole('button', { name: /New playlist/ })).toBeVisible()
    await expect(create.getByRole('button', { name: /Ask Beatie/ })).toBeVisible()
    expect(await aboveBar(page, '[data-sheet]')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(create).toHaveCount(0)

    const chip = page.getByRole('button', { name: 'Match my mood' })
    await expect(chip).toBeVisible()
    await chip.click()
    const mood = page.getByRole('region', { name: 'Your daily check-in' })
    await expect(mood).toBeVisible()
    expect(await aboveBar(page, '[role="dialog"]')).toBe(true)
  })

  test("Create's rows open the composer, the new-playlist form and Ask Beatie", async ({ page }) => {
    await login(page, email)
    await page.goto('/')
    const open = async (row: RegExp) => {
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByRole('dialog', { name: 'Create' }).getByRole('button', { name: row }).click()
    }
    await open(/Write a review/)
    await expect(page.getByRole('dialog', { name: /New review/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await open(/Ask Beatie/)
    await expect(page.getByRole('dialog', { name: 'Ask Beatie' })).toBeVisible()
    await page.keyboard.press('Escape')

    await open(/New playlist/)
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible()
  })
})

/** The sheet's middle, where it overlaps the bar, is the sheet, not the bar. */
async function aboveBar(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const nav = document.querySelector('nav[aria-label="Primary"]')!.getBoundingClientRect()
    const hit = document.elementFromPoint(innerWidth / 2, nav.top + nav.height / 2)
    return Boolean(hit?.closest(sel))
  }, selector)
}
