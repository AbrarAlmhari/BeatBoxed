import { test, expect, type Page } from '@playwright/test'
import { adminFetch, createNewUser, createTestUser, deleteTestUsers, login } from './helpers'

/**
 * Onboarding (docs/mockups/onboarding): new accounts go through /welcome,
 * music tags are the user's own, the Beatie tour, and the one-time card for
 * existing users. Sign-up and the email confirmation screens are checked
 * with the auth calls stubbed, so no real email is sent.
 */

type User = { id: string; email: string }

async function profileRow(id: string) {
  const [row] = (await (
    await adminFetch(
      `/rest/v1/profiles?id=eq.${id}&select=username,display_name,favorite_genres,setup_completed_at,setup_step,tutorial_completed_at,tutorial_skipped_at,welcome_card_dismissed_at`
    )
  ).json()) as Record<string, unknown>[]
  return row
}

const cont = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true })
const stepLabel = (page: Page, n: number) => page.getByText(`Step ${n} of 7`, { exact: true })

async function rate(page: Page, stars: number) {
  const radio = page.getByRole('radio', { name: `${stars} star${stars > 1 ? 's' : ''}`, exact: true })
  await page.locator('label', { has: radio }).click()
  await expect(radio).toBeChecked()
}

test.describe('onboarding', () => {
  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('a new account goes through setup, step by step, and lands on Home', async ({ page }) => {
    const me: User = await createNewUser('ob-new')
    await login(page, me.email)
    await expect(page).toHaveURL(/\/welcome$/)

    // 1. Username: prefilled from the email, checked live, required.
    await expect(stepLabel(page, 1)).toBeVisible()
    await expect(page.getByText('Required', { exact: true })).toBeVisible()
    const username = page.getByLabel('Username')
    await expect(username).toHaveValue('obnew')
    await username.fill('ob')
    await expect(page.getByRole('status').filter({ hasText: 'At least 4 characters' })).toBeVisible()
    await expect(cont(page)).toBeDisabled()
    const chosen = `ob.${Date.now().toString(36).slice(-6)}`
    await username.fill(chosen)
    await expect(page.getByText(`@${chosen} is available`)).toBeVisible()
    await cont(page).click()

    // 2. Display name is required; there's no Skip.
    await expect(stepLabel(page, 2)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0)
    const displayName = page.getByRole('textbox', { name: /Display name/ })
    await displayName.fill('')
    await expect(cont(page)).toBeDisabled()
    await displayName.fill('Onboarding Tester')
    await page.getByRole('textbox', { name: /Bio/ }).fill('Late-night playlist maker.')
    await expect(page.getByText('26 / 160')).toBeVisible()
    await cont(page).click()

    // 3. Tags: at least 3, and a custom one.
    await expect(stepLabel(page, 3)).toBeVisible()
    await page.getByRole('button', { name: 'R&B', exact: true }).click()
    await page.getByRole('button', { name: 'Indie', exact: true }).click()
    await expect(cont(page)).toBeDisabled()
    await page.getByLabel('Search or add your own tag').fill('Dream Pop')
    await page.getByRole('button', { name: '+ Add “Dream Pop”' }).click()
    await expect(page.getByText('3 selected')).toBeVisible()
    await cont(page).click()

    // 4. People: optional.
    await expect(stepLabel(page, 4)).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()

    // 5. Artists: follow one from the suggestions.
    await expect(stepLabel(page, 5)).toBeVisible()
    await page.getByRole('list', { name: 'Suggested artists' }).getByRole('button').first().click()
    await expect(page.getByText('1 artist followed')).toBeVisible()
    await cont(page).click()

    // 6. Songs: like one suggestion; likes survive a search and back.
    await expect(stepLabel(page, 6)).toBeVisible()
    const suggested = page.getByRole('list', { name: 'Suggested songs' })
    await suggested.getByRole('button', { name: /^Like / }).first().click()
    await expect(page.getByText('1 song liked')).toBeVisible()
    await page.getByLabel('Search songs or artists').fill('love')
    await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('Search songs or artists').fill('')
    await expect(page.getByText('1 song liked')).toBeVisible()
    await cont(page).click()

    // 7. A short first review: saved, with the note that it stays out of the feed.
    await expect(stepLabel(page, 7)).toBeVisible()
    await expect(page.getByText("Reviews under 20 characters won't show in the feed.")).toBeVisible()
    await rate(page, 5)
    await page.getByLabel('Your review').fill('So good.')
    await page.getByRole('button', { name: 'Post review' }).click()

    // All set: the profile card and the counts.
    await expect(page.getByRole('heading', { name: 'You\'re all set, Onboarding Tester!' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Music tags' }).getByText('Dream Pop')).toBeVisible()
    await page.getByRole('button', { name: "Skip, I'll explore on my own" }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText("You're ready!")).toBeVisible()
    const row = await profileRow(me.id)
    expect(row.username).toBe(chosen)
    expect(row.display_name).toBe('Onboarding Tester')
    expect(row.favorite_genres).toEqual(['R&B', 'Indie', 'Dream Pop'])
    expect(row.setup_completed_at).toBeTruthy()
    expect(row.tutorial_skipped_at).toBeTruthy()

    // Never again.
    await page.goto('/welcome')
    await expect(page).toHaveURL(/\/$/)
  })

  test('leaving halfway resumes at the same step, and the app sends you back to it', async ({ page }) => {
    const me = await createNewUser('ob-resume')
    await login(page, me.email)
    await cont(page).click()
    await page.getByRole('textbox', { name: /Display name/ }).fill('Resumer')
    await cont(page).click()
    await expect(stepLabel(page, 3)).toBeVisible()
    await expect.poll(async () => (await profileRow(me.id)).setup_step).toBe(3)

    await page.goto('/explore')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(stepLabel(page, 3)).toBeVisible()
  })

  test('the tour: six steps, Back and Next, then Finish; Escape skips', async ({ page }) => {
    const me = await createTestUser('ob-tour')
    await login(page, me.email)
    await page.goto('/?tour=1')
    const tour = page.getByRole('dialog', { name: 'This is your feed' })
    await expect(tour).toBeVisible()
    await expect(page.getByText('Step 1 of 6')).toBeVisible()

    const titles = ['Rate a song', 'Ask me anything', 'Explore', 'Your library', 'Your profile']
    for (const title of titles) {
      await page.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByRole('dialog', { name: title })).toBeVisible()
    }
    // The Ask Beatie step explains songs; it doesn't recommend them.
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText(/Ask me what the lyrics mean, get a translation, or learn about the artist/)).toBeVisible()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText("You're ready!")).toBeVisible()
    await expect.poll(async () => (await profileRow(me.id)).tutorial_completed_at).toBeTruthy()

    // It doesn't start again on its own.
    await page.reload()
    await expect(page.getByTestId('beatie-tour')).toHaveCount(0)

    // Replay from Settings; Escape skips.
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Replay tour' }).click()
    await expect(page.getByRole('dialog', { name: 'This is your feed' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('beatie-tour')).toHaveCount(0)
    await expect.poll(async () => (await profileRow(me.id)).tutorial_skipped_at).toBeTruthy()
  })

  test('existing users: the one-time card opens the tags in Edit profile, and the header shows only chosen tags', async ({
    page,
  }) => {
    const me = await createTestUser('ob-existing')
    await adminFetch(`/rest/v1/profiles?id=eq.${me.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ welcome_card_dismissed_at: null }),
    })
    await login(page, me.email)
    await expect(page).toHaveURL(/\/$/)
    const card = page.getByRole('region', { name: 'Your music tags are back' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Pick my tags' }).click()

    await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()
    await expect(page.getByText('0 of 8')).toBeVisible()
    await page.getByRole('button', { name: '+ Jazz' }).click()
    await page.getByRole('button', { name: '+ Soul' }).click()
    await expect(page.getByText('2 of 8')).toBeVisible()
    await page.getByRole('button', { name: 'Remove Soul' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Music tags' }).getByText('Jazz')).toBeVisible()
    expect((await profileRow(me.id)).favorite_genres).toEqual(['Jazz'])

    // The card is gone for good.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Edit profile' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Your music tags are back' })).toHaveCount(0)
  })

  test('no tags: your own profile offers to add them; someone else\'s shows nothing', async ({ page }) => {
    const me = await createTestUser('ob-notags')
    const other = await createTestUser('ob-other')
    await login(page, me.email)
    await page.goto(`/profile/${me.id}`)
    await page.getByRole('button', { name: 'Add your music tags' }).click()
    await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()
    await page.goto(`/profile/${other.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add your music tags' })).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Music tags' })).toHaveCount(0)
  })

  test('sign-up asks only for email and password, then shows check-your-email with Resend and Go back', async ({
    page,
  }) => {
    let resent = 0
    await page.route('**/auth/v1/signup**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', email: 'new@beatboxed.test', aud: 'authenticated' }),
      })
    )
    await page.route('**/auth/v1/resend**', (route) => {
      resent += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/signup')
    await expect(page.getByLabel('Username')).toHaveCount(0)
    await expect(page.getByLabel('Display name')).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Email' }).fill('new@beatboxed.test')
    await page.getByRole('textbox', { name: 'Password' }).fill('short')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible()
    await page.getByRole('textbox', { name: 'Password' }).fill('long enough pw')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByText('new@beatboxed.test')).toBeVisible()
    await page.getByRole('button', { name: 'Resend email' }).click()
    await expect(page.getByText('Sent again to new@beatboxed.test.')).toBeVisible()
    expect(resent).toBe(1)
    await page.getByRole('button', { name: 'Wrong email? Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  })

  test('logging in before confirming says so, with a resend button', async ({ page }) => {
    await page.route('**/auth/v1/token?grant_type=password', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }),
      })
    )
    await page.route('**/auth/v1/resend**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    )
    await page.goto('/login')
    await page.getByRole('textbox', { name: 'Email' }).fill('waiting@beatboxed.test')
    await page.getByRole('textbox', { name: 'Password' }).fill('long enough pw')
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByText(/Confirm your email first/)).toBeVisible()
    await page.getByRole('button', { name: 'Resend email' }).click()
    await expect(page.getByText('Sent again to waiting@beatboxed.test.')).toBeVisible()
  })
})
