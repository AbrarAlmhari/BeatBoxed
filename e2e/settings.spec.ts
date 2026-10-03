import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createPlaylistWithSongs,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  likeReviewAs,
  login,
  logout,
  makeFriends,
  notificationsOf,
  settingsOf,
  songRatingFacts,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * Settings, and the privacy rules behind them.
 *
 * The privacy tests deliberately check the database as well as the page: the
 * rules live in RLS so that a future review feed inherits them, and a test
 * that only looked at the screen couldn't tell enforcement from hiding.
 */
test.describe('settings', () => {
  let owner: { id: string; email: string }
  let friend: { id: string; email: string }
  let stranger: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    owner = await createTestUser('set-owner')
    friend = await createTestUser('set-friend')
    stranger = await createTestUser('set-stranger')
    songs = await distinctSongs(2)
    await makeFriends(owner.id, friend.id)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  const toggle = (page: Page, name: string) =>
    page.getByRole('switch', { name })

  test('every setting saves and is still set after a refresh', async ({ page }) => {
    await login(page, owner.email)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'العربية' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    await toggle(page, 'Likes on your reviews').click()
    await toggle(page, 'Beatboxed updates').click()
    await toggle(page, 'Show my friends list').click()

    // Settled in the database, not just on screen.
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.translation_language)
      .toBe('ar')
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.friends_list_visible)
      .toBe(false)
    await expect
      .poll(async () => (await settingsOf(owner.id)).prefs?.review_liked)
      .toBe(false)

    await page.reload()
    await expect(page.getByRole('button', { name: 'العربية' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(toggle(page, 'Likes on your reviews')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await expect(toggle(page, 'Beatboxed updates')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await expect(toggle(page, 'Show my friends list')).toHaveAttribute(
      'aria-checked',
      'false'
    )

    // Put the friends list back for the later tests.
    await toggle(page, 'Show my friends list').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.friends_list_visible)
      .toBe(true)
  })

  test('turning off review likes stops the notification being created', async ({
    page,
  }) => {
    await login(page, owner.email)
    const reviewId = await createReview(owner.id, songs[0].id, 5, 'A review')
    const strangerToken = await tokenFor(stranger.email)

    // Start from on, explicitly: the previous test turns this switch off and
    // these share an account, so inheriting its state would make the first
    // half of this test assert nothing.
    await page.goto('/settings')
    if (
      (await toggle(page, 'Likes on your reviews').getAttribute('aria-checked')) ===
      'false'
    ) {
      await toggle(page, 'Likes on your reviews').click()
    }
    await expect
      .poll(async () => (await settingsOf(owner.id)).prefs?.review_liked)
      .toBe(true)

    // On: the like notifies.
    const first = await likeReviewAs(strangerToken, reviewId, stranger.id)
    expect(first.status).toBeLessThan(400)
    await expect
      .poll(async () => (await notificationsOf(owner.id)).length)
      .toBe(1)

    // Switch it off, unlike, like again: no new row.
    await page.goto('/settings')
    await toggle(page, 'Likes on your reviews').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).prefs?.review_liked)
      .toBe(false)

    await deleteLikeAndNotifications(owner.id, reviewId, stranger.id)

    const second = await likeReviewAs(strangerToken, reviewId, stranger.id)
    expect(second.status).toBeLessThan(400)
    // Give the trigger a moment, then confirm nothing arrived.
    await page.waitForTimeout(1500)
    expect(await notificationsOf(owner.id)).toHaveLength(0)
  })

  test('a private account hides its content from a non-friend but keeps its counts', async ({
    page,
  }) => {
    await createReview(owner.id, songs[1].id, 4, 'Private thoughts')
    await createPlaylistWithSongs(owner.id, 'Private List', [songs[1].id])

    await login(page, owner.email)
    await page.goto('/settings')
    await toggle(page, 'Private account').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.is_private)
      .toBe(true)

    await logout(page)
    await login(page, stranger.email)
    await page.goto(`/profile/${owner.id}`)

    // The explanation, not an empty page.
    await expect(
      page.getByText(
        'This account is private. Add them as a friend to see their reviews and playlists.'
      )
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Private List/ })).toHaveCount(0)

    // Counts stay visible even though the rows behind them don't.
    await expect(page.getByText('Reviews written')).toBeVisible()

    // And the reviews are gone from the song page too, not just the profile.
    await page.goto(`/song/${songs[1].id}`)
    await expect(page.getByText('Private thoughts')).toHaveCount(0)

    // But the rating still counts towards the song's average, anonymously.
    const facts = await songRatingFacts(songs[1].id)
    await expect
      .poll(async () => {
        const text = await page.locator('body').innerText()
        return text.includes(String(facts.avg?.toFixed(1)))
      })
      .toBe(true)
  })

  test('a friend sees everything on a private account', async ({ page }) => {
    await login(page, friend.email)
    await page.goto(`/profile/${owner.id}`)

    await expect(page.getByText('This account is private.')).toHaveCount(0)
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(page.getByRole('link', { name: /Private List/ })).toBeVisible()
  })

  test('switching back to public makes everything visible again', async ({ page }) => {
    await login(page, owner.email)
    await page.goto('/settings')
    await toggle(page, 'Private account').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.is_private)
      .toBe(false)

    await logout(page)
    await login(page, stranger.email)
    await page.goto(`/profile/${owner.id}`)
    await expect(page.getByText('This account is private.')).toHaveCount(0)
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(page.getByRole('link', { name: /Private List/ })).toBeVisible()
  })

  test('a hidden friends list is hidden from friends too', async ({ page }) => {
    await login(page, owner.email)
    await page.goto('/settings')
    await toggle(page, 'Show my friends list').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.friends_list_visible)
      .toBe(false)

    // Even an accepted friend gets nothing.
    await logout(page)
    await login(page, friend.email)
    await page.goto(`/profile/${owner.id}/friends`)
    await expect(page.getByText(/friends list is private/i)).toBeVisible()

    // The owner still sees their own list.
    await logout(page)
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/friends`)
    await expect(page.getByText(/friends list is private/i)).toHaveCount(0)

    // Leave it visible for any later run against the same accounts.
    await page.goto('/settings')
    await toggle(page, 'Show my friends list').click()
  })

  test('log out works from Settings', async ({ page }) => {
    await login(page, stranger.email)
    await page.goto('/settings')
    await page.getByRole('button', { name: /log out/i }).click()
    await page.waitForURL(/\/login/)
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  })
})

/** Clears a like and any notification it produced, between the two attempts. */
async function deleteLikeAndNotifications(
  ownerId: string,
  reviewId: string,
  actorId: string
) {
  await adminFetch(
    `/rest/v1/review_likes?review_id=eq.${reviewId}&user_id=eq.${actorId}`,
    { method: 'DELETE' }
  )
  await adminFetch(`/rest/v1/notifications?user_id=eq.${ownerId}`, {
    method: 'DELETE',
  })
}
