import { test, expect, type Page } from '@playwright/test'
import { createTestUser, deleteTestUsers, login, notificationFilters } from './helpers'

/**
 * The notifications filter: a button beside the title opening a bottom sheet
 * on a phone (a menu under the button on a computer) with the seven filters
 * as one-choice rows. A new account has the "Reviews are live" announcement,
 * which is enough to see a filter apply.
 */

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`notif-filter-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

const button = (page: Page) => page.getByRole('button', { name: /^Filter notifications/ })
const rows = (page: Page) => notificationFilters(page).getByRole('radio')
const dot = (page: Page) => button(page).locator('[data-filter-dot]')
const note = (page: Page) => page.locator('[data-filter-note]')
const announcement = (page: Page) => page.getByText('Reviews are live')

/** Waits for a phone's sheet to finish sliding up. */
async function settled(page: Page) {
  const height = page.viewportSize()!.height
  await expect
    .poll(async () => {
      const b = (await notificationFilters(page).boundingBox())!
      return Math.round(b.y + b.height)
    })
    .toBeLessThanOrEqual(height)
}

async function open(page: Page) {
  await login(page, user.email)
  await page.goto('/notifications')
  await expect(announcement(page)).toBeVisible()
}

test('the strip bar is gone; the button opens the filters with All chosen', async ({ page }, info) => {
  await open(page)
  await expect(page.getByRole('group', { name: 'Filter notifications' })).toHaveCount(0)
  const box = (await button(page).boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await expect(dot(page)).toHaveCount(0)
  await expect(note(page)).toHaveCount(0)

  await button(page).click()
  await expect(notificationFilters(page)).toBeVisible()
  await expect(rows(page)).toHaveText([/^All/, /^Mentions/, /^Replies/, /^Likes/, /^Follows/, /^Artists/, /^Beatboxed/])
  await expect(rows(page).first()).toHaveAttribute('aria-checked', 'true')
  await expect(notificationFilters(page).getByRole('button', { name: 'Clear filter' })).toHaveCount(0)
  // Focus moves into it.
  expect(await notificationFilters(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)

  // A bottom sheet on a phone, a menu under the button on a computer.
  if (info.project.name === 'mobile') await settled(page)
  const sheet = (await notificationFilters(page).boundingBox())!
  const viewport = page.viewportSize()!
  if (info.project.name === 'mobile') expect(Math.round(sheet.y + sheet.height)).toBe(viewport.height)
  else expect(sheet.y).toBeGreaterThan(box.y + box.height)
})

test('choosing a filter applies it, closes, and shows the dot and its name; Clear filter resets', async ({ page }) => {
  await open(page)
  await button(page).click()
  await rows(page).filter({ hasText: 'Mentions' }).click()

  await expect(notificationFilters(page)).toHaveCount(0)
  await expect(button(page)).toBeFocused()
  await expect(dot(page)).toBeVisible()
  await expect(note(page)).toHaveText('Showing: Mentions')
  await expect(button(page)).toHaveAccessibleName('Filter notifications, showing Mentions')
  await expect(announcement(page)).toHaveCount(0)
  await expect(page.getByText('When someone @mentions you, it shows up here.')).toBeVisible()

  await button(page).click()
  await expect(rows(page).filter({ hasText: 'Mentions' })).toHaveAttribute('aria-checked', 'true')
  await notificationFilters(page).getByRole('button', { name: 'Clear filter' }).click()

  await expect(notificationFilters(page)).toHaveCount(0)
  await expect(dot(page)).toHaveCount(0)
  await expect(note(page)).toHaveCount(0)
  await expect(announcement(page)).toBeVisible()
})

test('Escape and a tap outside close it, back on the button', async ({ page }) => {
  await open(page)
  await button(page).click()
  await page.keyboard.press('Escape')
  await expect(notificationFilters(page)).toHaveCount(0)
  await expect(button(page)).toBeFocused()

  await button(page).click()
  await expect(notificationFilters(page)).toBeVisible()
  await page.locator('[data-sheet-backdrop]').click({ position: { x: 10, y: 10 } })
  await expect(notificationFilters(page)).toHaveCount(0)
  await expect(button(page)).toBeFocused()
})

test('a phone can swipe the sheet down to close it', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Touch only')
  await open(page)
  await button(page).click()
  await settled(page)
  const handle = notificationFilters(page).locator('[data-sheet-handle]')
  const box = (await handle.boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', py = y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: py }] })
  await touch('touchStart')
  for (let i = 1; i <= 10; i++) await touch('touchMove', y + i * 30)
  await touch('touchEnd')
  await cdp.detach()
  await expect(notificationFilters(page)).toHaveCount(0)
})

test('no slide-in with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await button(page).click()
  await expect(notificationFilters(page)).toHaveCSS('animation-name', 'none')
})
