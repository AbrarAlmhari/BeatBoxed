import { test, expect, type Page } from './fixtures'
import { createTestUser, deleteTestUsers, filterSheet, login } from './helpers'

/**
 * The filter button on each list that has one (Notifications and Explore
 * have their own specs): a sheet on a phone, a menu on a computer, a tap
 * applies and closes, and the button and page say what's showing.
 */

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`filter-button-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

test.describe('profile Reviews tab', () => {
  const button = (page: Page) => page.getByRole('button', { name: /^Filter reviews/ })
  const sheet = (page: Page) => filterSheet(page, 'Filter reviews')
  const section = (page: Page, name: string) => sheet(page).getByRole('radiogroup', { name })
  const note = (page: Page) => page.locator('[data-filter-note]')
  const dot = (page: Page) => button(page).locator('[data-filter-dot]')

  async function open(page: Page) {
    await login(page, user.email)
    await page.goto(`/profile/${user.id}`)
    await expect(button(page)).toBeVisible()
  }

  test('one button holds Show and Sort by, with All and Newest chosen', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Sort:/ })).toHaveCount(0)
    await expect(dot(page)).toHaveCount(0)
    await expect(note(page)).toHaveText('')

    await button(page).click()
    await expect(section(page, 'Show').getByRole('radio')).toHaveText([/^All/, /^Written/, /^Ratings only/])
    await expect(section(page, 'Sort by').getByRole('radio')).toHaveText(['Newest', 'Highest rated', 'Most liked'])
    await expect(section(page, 'Show').getByRole('radio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true')
    await expect(section(page, 'Sort by').getByRole('radio', { name: 'Newest' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet(page).getByText('Show', { exact: true })).toBeVisible()
    await expect(sheet(page).getByText('Sort by', { exact: true })).toBeVisible()
    await expect(sheet(page).getByRole('button', { name: 'Clear filter' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    await expect(button(page)).toBeFocused()
  })

  test('each choice applies and closes; the dot and note follow; Clear filter resets both', async ({ page }) => {
    await open(page)
    await button(page).click()
    await section(page, 'Show').getByRole('radio', { name: /^Written/ }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page).toHaveURL(/filter=written/)
    await expect(dot(page)).toBeVisible()
    await expect(note(page)).toHaveText('Showing: Written')

    await button(page).click()
    await section(page, 'Sort by').getByRole('radio', { name: 'Highest rated' }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(note(page)).toHaveText('Showing: Written · Sorted by highest rated')
    await expect(button(page)).toHaveAccessibleName('Filter reviews, showing Written, sort by Highest rated')

    await button(page).click()
    await sheet(page).getByRole('button', { name: 'Clear filter' }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/filter=/)
    await expect(dot(page)).toHaveCount(0)
    await expect(note(page)).toHaveText('')
    await button(page).click()
    await expect(section(page, 'Sort by').getByRole('radio', { name: 'Newest' })).toHaveAttribute('aria-checked', 'true')
  })

  test('a sort on its own still shows the dot; a tap outside closes', async ({ page }) => {
    await open(page)
    await button(page).click()
    await section(page, 'Sort by').getByRole('radio', { name: 'Most liked' }).click()
    await expect(dot(page)).toBeVisible()
    await expect(note(page)).toHaveText('Sorted by most liked')

    await button(page).click()
    await page.locator('[data-sheet-backdrop]').click({ position: { x: 10, y: 10 } })
    await expect(sheet(page)).toHaveCount(0)
    await expect(button(page)).toBeFocused()
  })
})
