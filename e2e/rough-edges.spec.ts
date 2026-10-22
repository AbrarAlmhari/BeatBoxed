import { test, expect, type Locator, type Page } from '@playwright/test'
import { commentAs, createReview, createTestUser, deleteTestUsers, distinctSongs, login, nameUser, tokenFor } from './helpers'

/**
 * Rough edges: long words stay inside their cards and run in their own
 * direction; sideways rows have arrows for mouse users; every sheet closes
 * every way, and the page behind stays still.
 */

const LAUGH = 'ه'.repeat(140)
const WORD = 'Supercalifragilisticexpialidocious'.repeat(5)

let author: { id: string; email: string }
let viewer: { id: string; email: string }
let songId: string
let reviewId: string

test.beforeAll(async ({}, info) => {
  const p = info.project.name
  author = await createTestUser(`rough-a-${p}`)
  viewer = await createTestUser(`rough-v-${p}`)
  await nameUser(author.id, `rougha${p}`.slice(0, 20), 'Rough Author')
  const [song] = await distinctSongs(1)
  songId = song.id
  reviewId = await createReview(author.id, songId, 4, LAUGH)
  const token = await tokenFor(viewer.email)
  await commentAs(token, reviewId, viewer.id, LAUGH)
  await commentAs(token, reviewId, viewer.id, WORD)
})

test.afterAll(async () => {
  await deleteTestUsers(author.email)
  await deleteTestUsers(viewer.email)
})

/** Nothing inside sticks out past the box's right or left edge. */
async function staysInside(box: Locator) {
  const spill = await box.evaluate((el) => {
    const r = el.getBoundingClientRect()
    let worst = 0
    for (const child of el.querySelectorAll<HTMLElement>('*')) {
      const c = child.getBoundingClientRect()
      if (c.width === 0) continue
      worst = Math.max(worst, c.right - r.right, r.left - c.left)
    }
    return worst
  })
  expect(spill).toBeLessThanOrEqual(1)
}

const direction = (el: Locator) => el.evaluate((n) => getComputedStyle(n).direction)

test.describe('long text', () => {
  test('a long Arabic laugh and a long English word stay inside the review card and the comments', async ({ page }) => {
    await login(page, viewer.email)
    await page.goto(`/song/${songId}?review=${reviewId}`)
    const card = page.locator(`article[data-review-id="${reviewId}"]`)
    await expect(card).toBeVisible()
    await staysInside(card)
    await expect(card.getByText(LAUGH)).toBeVisible()
    expect(await direction(card.getByText(LAUGH))).toBe('rtl')

    await card.getByRole('button', { name: /comments?$/i }).first().click()
    const sheet = page.getByRole('dialog')
    const scope = (await sheet.count()) > 0 ? sheet : card
    const laugh = scope.locator('[data-comment-id]').filter({ hasText: LAUGH }).first()
    const word = scope.locator('[data-comment-id]').filter({ hasText: WORD }).first()
    await expect(laugh).toBeVisible()
    await staysInside(laugh)
    await staysInside(word)
    expect(await direction(laugh.locator('p[dir="auto"]'))).toBe('rtl')
    expect(await direction(word.locator('p[dir="auto"]'))).toBe('ltr')
    // And nothing makes the page wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('sideways rows', () => {
  async function trending(page: Page) {
    await login(page, viewer.email)
    await page.goto('/explore')
    const row = page.getByRole('list', { name: 'Trending' })
    await expect(row.getByRole('link').nth(5)).toBeVisible()
    return row
  }
  const arrow = (page: Page, side: 'left' | 'right') =>
    page.locator('[data-scroll-row]').filter({ has: page.getByRole('list', { name: 'Trending' }) }).locator(`[data-row-arrow="${side}"]`)
  const scrollLeft = (row: Locator) => row.evaluate((el) => el.scrollLeft)

  test('arrows appear on hover, scroll the row, and hide at each end (computer)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mouse only')
    const row = await trending(page)
    await expect(arrow(page, 'left')).toHaveCount(0)
    await expect(arrow(page, 'right')).toHaveCSS('opacity', '0')
    await row.hover()
    await expect(arrow(page, 'right')).toHaveCSS('opacity', '1')

    await arrow(page, 'right').click()
    await expect.poll(() => scrollLeft(row)).toBeGreaterThan(300)
    await expect(arrow(page, 'left')).toBeVisible()

    await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }))
    await expect(arrow(page, 'right')).toHaveCount(0)
    await arrow(page, 'left').click()
    await row.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }))
    await expect(arrow(page, 'left')).toHaveCount(0)
  })

  test('shift+wheel and the keyboard move along the row (computer)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mouse only')
    const row = await trending(page)
    await row.hover()
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 400)
    await page.keyboard.up('Shift')
    await expect.poll(() => scrollLeft(row)).toBeGreaterThan(0)

    await row.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }))
    const first = row.getByRole('link').first()
    await first.focus()
    await page.keyboard.press('ArrowRight')
    const focusedItem = await page.evaluate(() => {
      const li = document.activeElement?.closest('li')
      return li ? Array.from(li.parentElement!.children).indexOf(li) : -1
    })
    expect(focusedItem).toBe(1)
  })

  test('a row that fits shows no arrows', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mouse only')
    await login(page, viewer.email)
    // The filter chips show once there's a search.
    await page.goto('/explore?q=radiohead')
    const chips = page.locator('[data-scroll-row]').filter({ has: page.getByRole('group', { name: 'Filter results' }) })
    await chips.hover()
    await expect(chips.locator('[data-row-arrow]')).toHaveCount(0)
  })

  test('no arrows on a phone; swiping still scrolls', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone only')
    const row = await trending(page)
    await expect(arrow(page, 'right')).toBeHidden()
    await row.evaluate((el) => el.scrollBy({ left: 300, behavior: 'instant' }))
    await expect.poll(() => scrollLeft(row)).toBeGreaterThan(0)
    await expect(arrow(page, 'left')).toBeHidden()
  })
})

test.describe('sheets', () => {
  /** The profile ⋯ menu (a small Sheet), opened from Home so Back has somewhere to go. */
  async function openProfileMenu(page: Page) {
    await login(page, viewer.email)
    await page.goto('/')
    await page.goto(`/profile/${author.id}`)
    await page.getByRole('button', { name: 'More options' }).locator('visible=true').click()
    const menu = page.getByRole('dialog', { name: 'Profile options' })
    await expect(menu).toBeVisible()
    return menu
  }

  /** Ask Beatie (a big Modal sheet). Signed in already. */
  async function openAskBeatie(page: Page) {
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask Beatie' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    return sheet
  }

  const outside = (page: Page) => page.mouse.click(6, 6)

  test('the profile menu sits on screen, over everything', async ({ page }, info) => {
    const menu = await openProfileMenu(page)
    // Once it has finished sliding up.
    await expect.poll(async () => (await menu.boundingBox())!.y).toBeLessThan(page.viewportSize()!.height - 100)
    await page.waitForTimeout(300)
    const box = (await menu.boundingBox())!
    const view = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    expect(box.y + box.height).toBeLessThanOrEqual(view.height)
    if (info.project.name === 'mobile') {
      // A bottom sheet, edge to edge, above the tab bar.
      expect(box.width).toBe(view.width)
      expect(Math.round(box.y + box.height)).toBe(view.height)
    } else {
      // A small pop-up, next to its button.
      expect(box.width).toBeLessThan(300)
      const button = (await page.getByRole('button', { name: 'More options' }).locator('visible=true').boundingBox())!
      expect(Math.abs(box.y - (button.y + button.height))).toBeLessThan(20)
    }
  })

  test('near the bottom of the screen a computer menu opens upward, fully on screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'computer pop-up menus only')
    await login(page, viewer.email)
    await page.goto(`/song/${songId}?review=${reviewId}`)
    const card = page.locator(`article[data-review-id="${reviewId}"]`)
    const button = card.getByRole('button', { name: 'Review options' })
    await expect(button).toBeVisible()
    // Put the button 40px above the bottom edge.
    await page.evaluate(() => document.body.style.setProperty('min-height', '400vh'))
    await button.evaluate((el) => {
      const r = el.getBoundingClientRect()
      window.scrollBy({ top: r.bottom - (window.innerHeight - 40), behavior: 'instant' })
    })
    const b = (await button.boundingBox())!
    expect(b.y + b.height).toBeGreaterThan(page.viewportSize()!.height - 60)
    await button.evaluate((el) => (el as HTMLElement).click())
    const menu = page.getByRole('dialog', { name: 'Review options' })
    await expect(menu).toBeVisible()
    await expect.poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(b.y)
    const m = (await menu.boundingBox())!
    const view = page.viewportSize()!
    expect(m.y).toBeGreaterThanOrEqual(0)
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(view.width)
  })

  test('closes by tapping outside, Escape and Cancel', async ({ page }, info) => {
    let menu = await openProfileMenu(page)
    await outside(page)
    await expect(menu).toHaveCount(0)

    await page.getByRole('button', { name: 'More options' }).locator('visible=true').click()
    menu = page.getByRole('dialog', { name: 'Profile options' })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    if (info.project.name === 'mobile') {
      await page.getByRole('button', { name: 'More options' }).locator('visible=true').click()
      await menu.getByRole('button', { name: 'Cancel' }).click()
      await expect(menu).toHaveCount(0)
    }
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.__sheet))).toBe(false)

    const sheet = await openAskBeatie(page)
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toHaveCount(0)
    await page.getByRole('button', { name: 'Ask Beatie' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Ask Beatie' }).click()
    await outside(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Back closes it and stays on the page', async ({ page }) => {
    const menu = await openProfileMenu(page)
    const url = page.url()
    await page.goBack()
    await expect(menu).toHaveCount(0)
    expect(page.url()).toBe(url)
    // The next Back leaves the page as usual.
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test('closed another way, the next Back leaves the page', async ({ page }) => {
    const menu = await openProfileMenu(page)
    await outside(page)
    await expect(menu).toHaveCount(0)
    // The step the menu added is taken out again.
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.__sheet))).toBe(false)
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test('the page behind does not scroll while a sheet is open', async ({ page }) => {
    await login(page, viewer.email)
    await page.goto(`/profile/${author.id}`)
    // Fully loaded first: a page that appears resets the scroll to the top.
    await expect(page.getByRole('heading', { name: 'Rough Author', level: 1 })).toBeVisible()
    await page.evaluate(() => document.body.style.setProperty('min-height', '400vh'))
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
    const scrollY = () => page.evaluate(() => window.scrollY)

    // A small menu, then a big sheet (the followers list). Clicked in place:
    // a normal click would first scroll the button back into view.
    const press = (button: Locator) => button.evaluate((el) => (el as HTMLElement).click())
    for (const open of [
      () => press(page.getByRole('button', { name: 'More options' }).locator('visible=true')),
      () => press(page.getByRole('button', { name: /followers?$/ }).first()),
    ]) {
      await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
      await open()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.mouse.move(6, 300)
      await page.mouse.wheel(0, 900)
      await page.waitForTimeout(400)
      expect(await scrollY()).toBe(600)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await scrollY()).toBe(600)
    }
  })

  test('swiping down: a short drag springs back, a long one closes', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone only')
    const menu = await openProfileMenu(page)
    const swipe = (distance: number) =>
      menu.evaluate(async (el, d) => {
        const handle = el.querySelector('[data-sheet-handle]') ?? el
        const r = handle.getBoundingClientRect()
        const x = r.left + r.width / 2
        const y0 = r.top + 5
        const touch = (y: number) => new Touch({ identifier: 1, target: handle, clientX: x, clientY: y })
        handle.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(y0)], bubbles: true, cancelable: true }))
        for (let i = 1; i <= 10; i++) {
          handle.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(y0 + (d * i) / 10)], bubbles: true, cancelable: true }))
          await new Promise((r) => setTimeout(r, 30))
        }
        const moved = getComputedStyle(el).transform
        handle.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(y0 + d)], bubbles: true }))
        return moved
      }, distance)

    // Follows the finger, then springs back.
    expect(await swipe(30)).not.toBe('none')
    await expect(menu).toBeVisible()
    await expect.poll(() => menu.evaluate((el) => el.style.transform)).toBe('')

    await swipe(400)
    await expect(menu).toHaveCount(0)
  })
})
