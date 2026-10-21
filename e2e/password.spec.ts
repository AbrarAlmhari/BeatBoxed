import { test, expect, type Page, type Request } from '@playwright/test'
import { adminFetch, createTestUser, deleteTestUsers, login, logout, TEST_PASSWORD } from './helpers'

/**
 * Forgot password, the reset link, Settings' change password, and where the
 * links in auth emails point.
 *
 * No real email is ever sent: the "send" calls are intercepted, and the
 * reset links are made with the admin API (generate_link), which makes a
 * real, working link without emailing it. Opening that link through
 * Supabase gives exactly what the email's link would, which the test then
 * opens on the local app (Supabase sends it to the Site URL, since
 * localhost isn't in the project's Redirect URLs).
 */

const NEW_PASSWORD = 'BrandNewPw789'

/** A reset link's landing, as Supabase sends it: "#access_token=…&type=recovery". */
async function resetLinkHash(email: string, { useTwice = false } = {}) {
  const res = await adminFetch('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'recovery', email }),
  })
  const { action_link } = await res.json()
  if (!action_link) throw new Error(`no reset link for ${email}`)
  let landing = await fetch(action_link, { redirect: 'manual' })
  if (useTwice) landing = await fetch(action_link, { redirect: 'manual' })
  const location = landing.headers.get('location') ?? ''
  return location.slice(location.indexOf('#'))
}

const local = (name: string) => `${name}-${test.info().project.name}`

async function logInWith(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
}

/** The redirect_to a stubbed auth call asked for. */
function redirectOf(request: Request) {
  return new URL(request.url()).searchParams.get('redirect_to')
}

test.describe('forgot password', () => {
  test('from Log in: sends a reset link to /reset-password and never says whether the account exists', async ({
    page,
  }) => {
    const sent: { email: string; redirect: string | null }[] = []
    await page.route('**/auth/v1/recover**', (route) => {
      sent.push({ email: route.request().postDataJSON().email, redirect: redirectOf(route.request()) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.clock.install()

    await page.goto('/login')
    await page.getByRole('textbox', { name: 'Email' }).fill('nobody-here@beatboxed.test')
    await page.getByRole('link', { name: 'Forgot password?' }).click()

    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
    // The email typed on Log in comes along.
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('nobody-here@beatboxed.test')
    await page.getByRole('button', { name: 'Send reset link' }).click()

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByText("If an account exists for nobody-here@beatboxed.test, we've sent a reset link.")).toBeVisible()
    expect(sent).toEqual([{ email: 'nobody-here@beatboxed.test', redirect: 'http://localhost:5173/reset-password' }])

    // Resend waits a minute (Supabase's own limit per address).
    const resend = page.getByRole('button', { name: /Resend email/ })
    await expect(resend).toBeDisabled()
    await expect(resend).toHaveText(/Resend email \(\d+s\)/)
    // A second at a time: each tick schedules the next after React re-renders.
    for (let s = 0; s < 61; s++) await page.clock.runFor(1000)
    await expect(resend).toBeEnabled()
    await resend.click()
    await expect(page.getByText('Sent again to nobody-here@beatboxed.test.')).toBeVisible()
    expect(sent).toHaveLength(2)
    await expect(resend).toBeDisabled()
  })

  test('asking again too soon still shows the same message, so it reveals nothing', async ({ page }) => {
    await page.route('**/auth/v1/recover**', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'For security purposes, you can only request this after 42 seconds.',
        }),
      })
    )
    await page.goto('/forgot-password')
    await page.getByRole('textbox', { name: 'Email' }).fill('someone@beatboxed.test')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText("If an account exists for someone@beatboxed.test, we've sent a reset link.")).toBeVisible()
  })

  test('an empty email gets a clear error, and nothing is sent', async ({ page }) => {
    let calls = 0
    await page.route('**/auth/v1/recover**', (route) => {
      calls += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/forgot-password')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText('Enter the email you signed up with.')).toBeVisible()
    expect(calls).toBe(0)
  })
})

test.describe('reset link', () => {
  let user: { id: string; email: string }

  test.beforeEach(async () => {
    user = await createTestUser(local('pw-reset'))
  })

  test.afterEach(async () => {
    await deleteTestUsers(user.email)
  })

  test('sets a new password: checks length and match, show/hide works, then Home with a toast', async ({ page }) => {
    await page.goto(`/reset-password${await resetLinkHash(user.email)}`)

    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await expect(page.getByText(`For ${user.email}.`)).toBeVisible()
    const next = page.getByRole('textbox', { name: 'New password', exact: true })
    const confirm = page.getByRole('textbox', { name: 'Confirm new password' })

    await next.fill('short')
    await confirm.fill('short')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible()

    await next.fill(NEW_PASSWORD)
    await confirm.fill(`${NEW_PASSWORD}x`)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByText("The two passwords don't match.")).toBeVisible()

    await expect(next).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).first().click()
    await expect(next).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(next).toHaveAttribute('type', 'password')

    await confirm.fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page).toHaveURL(/localhost:5173\/$/)
    await expect(page.getByRole('status').filter({ hasText: 'Password updated' })).toBeVisible()

    // The new password works, and the old one doesn't.
    await logout(page)
    await logInWith(page, user.email, TEST_PASSWORD)
    await expect(page.getByText("That email and password don't match an account.", { exact: false })).toBeVisible()
    await logInWith(page, user.email, NEW_PASSWORD)
    await page.waitForURL((u) => !u.pathname.includes('/login'))
  })

  test('a link that lands on the home page (the Site URL) still opens the reset form', async ({ page }) => {
    await page.goto(`/${await resetLinkHash(user.email)}`)
    await expect(page).toHaveURL(/\/reset-password$/)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  })

  test('the form survives a refresh', async ({ page }) => {
    await page.goto(`/reset-password${await resetLinkHash(user.email)}`)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  })

  test('a used (or expired) link says so, and offers a new one', async ({ page }) => {
    const hash = await resetLinkHash(user.email, { useTwice: true })
    expect(hash).toContain('error_code=otp_expired')
    await page.goto(`/reset-password${hash}`)

    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Send a new link' }).click()
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  })

  test('opening /reset-password without a link shows the expired page, even when signed in', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
    await login(page, user.email)
    await page.goto('/reset-password')
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
  })
})

test.describe('change password in Settings', () => {
  let user: { id: string; email: string }

  test.beforeEach(async () => {
    user = await createTestUser(local('pw-change'))
  })

  test.afterEach(async () => {
    await deleteTestUsers(user.email)
  })

  test('checks the current password, then changes it', async ({ page }) => {
    await login(page, user.email)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Change password' }).click()
    const form = page.getByRole('form', { name: 'Change password' })
    const current = form.getByRole('textbox', { name: 'Current password' })
    const next = form.getByRole('textbox', { name: 'New password', exact: true })
    const confirm = form.getByRole('textbox', { name: 'Confirm new password' })

    await current.fill('not-my-password')
    await next.fill(NEW_PASSWORD)
    await confirm.fill(NEW_PASSWORD)
    await form.getByRole('button', { name: 'Save new password' }).click()
    await expect(form.getByText("That's not your current password.")).toBeVisible()

    await current.fill(TEST_PASSWORD)
    await confirm.fill('different-one')
    await form.getByRole('button', { name: 'Save new password' }).click()
    await expect(form.getByText("The two passwords don't match.")).toBeVisible()

    await confirm.fill(NEW_PASSWORD)
    await form.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Password updated' })).toBeVisible()
    await expect(form).toHaveCount(0)

    await logout(page)
    await logInWith(page, user.email, NEW_PASSWORD)
    await page.waitForURL((u) => !u.pathname.includes('/login'))
  })

  test('Cancel closes the form without changing anything', async ({ page }) => {
    let updates = 0
    await page.route('**/auth/v1/user', (route) => {
      if (route.request().method() === 'PUT') updates += 1
      return route.fallback()
    })
    await login(page, user.email)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('form', { name: 'Change password' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
    expect(updates).toBe(0)
  })
})

test.describe('email links', () => {
  test('sign-up confirmation and its resend link back to /welcome on this address', async ({ page }) => {
    const redirects: string[] = []
    await page.route('**/auth/v1/signup**', (route) => {
      redirects.push(`signup ${redirectOf(route.request())}`)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000002', email: 'links@beatboxed.test', aud: 'authenticated' }),
      })
    })
    await page.route('**/auth/v1/resend**', (route) => {
      redirects.push(`resend ${redirectOf(route.request())}`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/signup')
    await page.getByRole('textbox', { name: 'Email' }).fill('links@beatboxed.test')
    await page.getByRole('textbox', { name: 'Password' }).fill('long enough pw')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('button', { name: 'Resend email' }).click()
    await expect(page.getByText('Sent again to links@beatboxed.test.')).toBeVisible()

    expect(redirects).toEqual([
      'signup http://localhost:5173/welcome',
      'resend http://localhost:5173/welcome',
    ])
  })

  test('refreshing a deep link loads the app, not a 404', async ({ page }) => {
    // The dev server already does this; vercel.json makes production match.
    const res = await page.goto('/forgot-password')
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  })
})
