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
  makeFollow,
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
  let follower: { id: string; email: string }
  let stranger: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    owner = await createTestUser('set-owner')
    follower = await createTestUser('set-follower')
    stranger = await createTestUser('set-stranger')
    songs = await distinctSongs(2)
    // An accepted follower from before the account goes private keeps
    // access afterwards, the same as on Instagram.
    await makeFollow(follower.id, owner.id)
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
    await toggle(page, 'Show my followers and following').click()

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
    await expect(toggle(page, 'Show my followers and following')).toHaveAttribute(
      'aria-checked',
      'false'
    )

    // Put the lists back for the later tests.
    await toggle(page, 'Show my followers and following').click()
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
    // Counted by type: the follower fixture left a new_follower row too.
    await expect
      .poll(async () => (await likeNotifications(owner.id)).length)
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
    expect(await likeNotifications(owner.id)).toHaveLength(0)
  })

  test('a private account hides its content from a non-follower but keeps its counts', async ({
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
        'This account is private. Follow them to request access to their reviews and playlists.'
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

  test('an accepted follower sees everything on a private account', async ({ page }) => {
    await login(page, follower.email)
    await page.goto(`/profile/${owner.id}`)

    await expect(page.getByText('This account is private.')).toHaveCount(0)
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(page.getByRole('link', { name: /Private List/ })).toBeVisible()
  })

  test('switching back to public makes everything visible again', async ({ page }) => {
    await login(page, owner.email)
    await page.goto('/settings')
    await toggle(page, 'Private account').click()
    // Going public asks first; nobody is waiting, so it's the short version.
    await page.getByRole('dialog').getByRole('button', { name: 'Make public' }).click()
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

  test('hidden follow lists are hidden from followers too', async ({ page }) => {
    await login(page, owner.email)
    await page.goto('/settings')
    await toggle(page, 'Show my followers and following').click()
    await expect
      .poll(async () => (await settingsOf(owner.id)).profile.friends_list_visible)
      .toBe(false)

    // Even an accepted follower gets nothing, on either list.
    await logout(page)
    await login(page, follower.email)
    for (const list of ['followers', 'following']) {
      await page.goto(`/profile/${owner.id}/${list}`)
      await expect(page.getByText(/followers and following are private/i)).toBeVisible()
    }

    // The owner still sees their own list, with the follower on it.
    await logout(page)
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}/followers`)
    await expect(page.getByText(/followers and following are private/i)).toHaveCount(0)
    await expect(page.locator(`a[href="/profile/${follower.id}"]`)).toBeVisible()

    // Leave it visible for any later run against the same accounts.
    await page.goto('/settings')
    await toggle(page, 'Show my followers and following').click()
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

async function likeNotifications(userId: string) {
  return (await notificationsOf(userId)).filter((n) => n.type === 'review_liked')
}
