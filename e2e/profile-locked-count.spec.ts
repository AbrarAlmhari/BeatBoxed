import { test, expect, type Page } from './fixtures'
import { createReview, createTestUser, deleteTestUsers, distinctSongs, login, setPrivate } from './helpers'

/**
 * A locked private profile has no tab bar, so its header shows the review
 * count. Other profiles show it on the Reviews tab and not twice.
 */
test.describe('review count on a locked profile', () => {
  let priv: { id: string; email: string }
  let viewer: { id: string; email: string }

  test.beforeAll(async ({}, info) => {
    priv = await createTestUser(`locked-count-${info.project.name}`)
    viewer = await createTestUser(`locked-viewer-${info.project.name}`)
    await setPrivate(priv.id, true)
    const songs = await distinctSongs(2)
    await createReview(priv.id, songs[0].id, 4, 'The chorus lifts the whole room every single time I play it.')
    await createReview(priv.id, songs[1].id, 2, 'Never quite found its footing for me, though the bass is lovely.')
  })

  test.afterAll(async () => {
    await deleteTestUsers(priv.email)
    await deleteTestUsers(viewer.email)
  })

  const counts = (page: Page) => page.getByRole('list', { name: 'Profile counts' })

  test('a stranger sees "2 reviews" beside the lock card', async ({ page }) => {
    await login(page, viewer.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByText('This account is private.', { exact: false })).toBeVisible()
    await expect(counts(page).getByRole('listitem').first()).toHaveText('2 reviews')
    // Just the number: the reviews themselves stay hidden.
    await expect(page.getByText('The chorus lifts the whole room')).toHaveCount(0)
  })

  test('one review reads in the singular', async ({ page }) => {
    const single = await createTestUser('locked-one')
    try {
      await setPrivate(single.id, true)
      const [song] = await distinctSongs(1)
      await createReview(single.id, song.id, 5, 'Three minutes that feel like one, and I would not change a note.')
      await login(page, viewer.email)
      await page.goto(`/profile/${single.id}`)
      await expect(counts(page).getByRole('listitem').first()).toHaveText('1 review')
    } finally {
      await deleteTestUsers(single.email)
    }
  })

  test('your own private profile keeps the count on its tab, not in the header', async ({ page }) => {
    await login(page, priv.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByRole('tab', { name: /Reviews/ })).toContainText('2')
    await expect(counts(page).getByText('reviews')).toHaveCount(0)
  })
})
