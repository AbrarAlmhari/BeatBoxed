import { test, expect, type Page } from '@playwright/test'
import { adminFetch, createTestUser, deleteTestUsers, env, login, pngBytes, tokenFor } from './helpers'

/**
 * Username rules (migration 0037): new and changed usernames are 4–20
 * characters of lowercase letters, numbers, _ and ., unique regardless of
 * case. Older, shorter usernames are kept, and their owners can edit the
 * rest of their profile as normal.
 */

type User = { id: string; email: string }

async function usernameOf(id: string) {
  const [row] = (await (await adminFetch(`/rest/v1/profiles?id=eq.${id}&select=username`)).json()) as {
    username: string
  }[]
  return row.username
}

/** A username set the way the existing short ones were: around the rule. */
async function setUsernameAsAdmin(id: string, username: string) {
  await adminFetch(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ username }) })
}

/** Changes your own username straight through the API, as a signed-in user. */
async function patchOwnUsername(email: string, id: string, username: string) {
  const token = await tokenFor(email)
  return fetch(`${env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username }),
  })
}

const status = (page: Page) => page.getByRole('status').filter({ hasText: /characters|letters|Taken|available|Checking/ })

test.describe('usernames', () => {
  let taken: User

  test.beforeAll(async () => {
    taken = await createTestUser('un-taken')
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('sign-up shows the rule and checks as you type', async ({ page }) => {
    const takenName = await usernameOf(taken.id)
    await page.goto('/signup')
    const field = page.getByLabel('Username')
    await expect(page.getByText('4–20 characters: letters, numbers, _ and .')).toBeVisible()

    await field.fill('ab')
    await expect(status(page)).toHaveText('At least 4 characters')
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()

    await field.fill('ab cd!')
    await expect(status(page)).toHaveText('Only letters, numbers, _ and .')

    await field.fill('a'.repeat(21))
    await expect(status(page)).toHaveText('At most 20 characters')

    // Capitals are lowercased as you type; taken regardless of case.
    await field.fill(takenName.toUpperCase())
    await expect(field).toHaveValue(takenName)
    await expect(status(page)).toHaveText('Taken')

    // Periods are fine, and "_" is matched exactly, not as a wildcard.
    const fresh = `new_${Date.now().toString(36)}.ok`
    await field.fill(fresh)
    await expect(status(page)).toHaveText(`@${fresh} is available`)
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  test('the database refuses a new short username, and lowercases a valid one', async () => {
    const me = await createTestUser('un-db')
    const refused = await patchOwnUsername(me.email, me.id, 'abc')
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { code: string }).code).toBe('23514')

    const ok = await patchOwnUsername(me.email, me.id, `Mixed.Case${Date.now().toString(36).slice(-4)}`)
    expect(ok.status).toBeLessThan(300)
    expect(await usernameOf(me.id)).toMatch(/^mixed\.case[a-z0-9]{1,4}$/)
  })

  test('an existing short username is kept: sign in and edit bio and picture freely', async ({ page }) => {
    const legacy = await createTestUser('un-legacy')
    const shortName = `z${Date.now().toString(36).slice(-2)}`
    await setUsernameAsAdmin(legacy.id, shortName)
    expect(await usernameOf(legacy.id)).toBe(shortName)

    await login(page, legacy.email)
    await page.goto(`/profile/${legacy.id}`)
    await expect(page.getByText(`@${shortName}`)).toBeVisible()
    // No rename prompt anywhere.
    await expect(page.getByText(/rename|choose a new username/i)).toHaveCount(0)

    await page.getByRole('button', { name: 'Edit profile' }).click()
    // Their current name is fine as it is: no error shown for it.
    await expect(status(page)).toHaveCount(0)
    await page.getByLabel('Bio').fill('Still here with my short name.')
    await page.locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: pngBytes(64, 64) })
    await expect(page.getByRole('button', { name: 'Uploading…' })).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Still here with my short name.')).toBeVisible()
    expect(await usernameOf(legacy.id)).toBe(shortName)

    // Changing it later means following the rule.
    await page.getByRole('button', { name: 'Edit profile' }).click()
    await page.getByLabel('Username').fill('ab')
    await expect(status(page)).toHaveText('At least 4 characters')
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })
})
