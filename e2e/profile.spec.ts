import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  makeFollow,
  setPrivate,
  type PlayableSong,
} from './helpers'

/**
 * The redesigned profile (Part A): header with a counts row, then
 * Reviews · Playlists · Stats · Likes, with the tab in the URL.
 */

type User = { id: string; email: string }

const WRITTEN = 'The second verse turns the whole song around, and the outro earns every second it takes.'

async function ratingOnly(userId: string, songId: string, rating: number) {
  await adminFetch('/rest/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, song_id: songId, rating }),
  })
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })

test.describe('profile', () => {
  let owner: User
  let friend: User
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    songs = await distinctSongs(6)
    owner = await createTestUser('prof-owner')
    friend = await createTestUser('prof-friend')
    await createReview(owner.id, songs[0].id, 5, WRITTEN)
    await ratingOnly(owner.id, songs[1].id, 2)
    await makeFollow(friend.id, owner.id)
    // A followed artist, for the artists count.
    const [song] = (await (await adminFetch(`/rest/v1/songs?id=eq.${songs[0].id}&select=artist_id`)).json()) as {
      artist_id: string
    }[]
    await adminFetch('/rest/v1/follows', {
      method: 'POST',
      body: JSON.stringify({ user_id: owner.id, artist_id: song.artist_id }),
    })
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('the tab lives in the URL, Back returns to the last tab, and arrows move between tabs', async ({
    page,
  }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}`)
    await expect(tab(page, 'Reviews')).toHaveAttribute('aria-selected', 'true')

    await tab(page, 'Likes').click()
    await expect(page).toHaveURL(/\?tab=likes/)
    await tab(page, 'Stats').click()
    await expect(page).toHaveURL(/\?tab=stats/)
    await expect(page.getByRole('group', { name: 'Time range' })).toBeVisible()

    await page.goBack()
    await expect(tab(page, 'Likes')).toHaveAttribute('aria-selected', 'true')

    // A link straight to a tab opens it.
    await page.goto(`/profile/${owner.id}?tab=playlists`)
    await expect(tab(page, 'Playlists')).toHaveAttribute('aria-selected', 'true')

    // Keyboard: arrows move along the tablist.
    await tab(page, 'Playlists').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'Stats')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'Stats')).toBeFocused()
  })

  test('the counts open the lists, and ratings or reviews switch the Reviews filter', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}?tab=likes`)

    await page.getByRole('button', { name: '1 follower', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Followers' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator(`a[href="/profile/${friend.id}"]`)).toBeVisible()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByRole('button', { name: '1 artist', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Artists followed' })).toBeVisible()
    await page.keyboard.press('Escape')

    // "1 review" (written) opens Reviews filtered to written ones.
    await page.getByRole('button', { name: '1 review', exact: true }).click()
    await expect(page).toHaveURL(/filter=written/)
    await expect(tab(page, 'Reviews')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Written' })).toHaveAttribute('aria-pressed', 'true')

    // "2 ratings" opens all of them.
    await page.getByRole('button', { name: '2 ratings', exact: true }).click()
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  test('Reviews: written ones are cards, ratings-only ones are compact rows, and the filters work', async ({
    page,
  }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}`)
    const panel = page.getByRole('tabpanel')

    // All: one card with the text, one compact row with no text.
    await expect(panel.locator('article[data-review-id]')).toHaveCount(1)
    await expect(panel.getByText(WRITTEN)).toBeVisible()
    const row = panel.locator(`a[href*="/song/${songs[1].id}?review="]`)
    await expect(row).toBeVisible()
    // Covers carry alt text.
    await expect(row.getByRole('img', { name: `Cover of ${songs[1].title}` })).toBeVisible()

    await page.getByRole('button', { name: 'Written' }).click()
    await expect(panel.getByText(WRITTEN)).toBeVisible()
    await expect(row).toHaveCount(0)

    await page.getByRole('button', { name: 'Ratings only' }).click()
    await expect(panel.getByText(WRITTEN)).toHaveCount(0)
    await expect(row).toBeVisible()

    // Sort: highest rated puts the 5-star review first.
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await page.getByRole('button', { name: /^Sort:/ }).click()
    await page.getByRole('button', { name: 'Highest rated' }).click()
    await expect(panel.locator('li').first()).toContainText(songs[0].title)
  })

  test('switching filters quickly never shows a slower, older answer', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}`)
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText(WRITTEN)).toBeVisible()

    // The "Written" answer is held back, so it lands after "Ratings only".
    await page.route(/\/rest\/v1\/reviews\?.*or=/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.getByRole('button', { name: 'Written' }).click()
    await page.getByRole('button', { name: 'Ratings only' }).click()

    const row = panel.locator(`a[href*="/song/${songs[1].id}?review="]`)
    await expect(row).toBeVisible()
    await page.waitForTimeout(2500) // past the held-back answer
    await expect(row).toBeVisible()
    await expect(panel.getByText(WRITTEN)).toHaveCount(0)
  })

  test("empty states: your own invites a first review; someone else's says so", async ({ page }) => {
    const fresh = await createTestUser('prof-empty')
    await login(page, fresh.email)
    await page.goto(`/profile/${fresh.id}`)
    await expect(page.getByText('No reviews yet')).toBeVisible()
    await page.getByRole('button', { name: 'Write your first review' }).click()
    await expect(page.getByRole('dialog', { name: 'New review' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Someone else's empty Playlists tab.
    const [profile] = (await (
      await adminFetch(`/rest/v1/profiles?id=eq.${friend.id}&select=username`)
    ).json()) as { username: string }[]
    await page.goto(`/profile/${friend.id}?tab=playlists`)
    await expect(page.getByText(`@${profile.username} hasn't made any playlists yet.`)).toBeVisible()
  })

  test('Likes: songs with play, and unliking from your own profile has Undo', async ({ page }) => {
    await adminFetch('/rest/v1/song_likes', {
      method: 'POST',
      body: JSON.stringify([
        { user_id: owner.id, song_id: songs[3].id },
        { user_id: owner.id, song_id: songs[4].id },
      ]),
    })
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}?tab=likes`)
    await expect(page.getByRole('button', { name: `Play ${songs[3].title}`, exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Unlike ${songs[3].title}`, exact: true }).click()
    await expect(page.getByRole('button', { name: `Unlike ${songs[3].title}`, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: `Unlike ${songs[3].title}`, exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        (
          (await (
            await adminFetch(`/rest/v1/song_likes?user_id=eq.${owner.id}&song_id=eq.${songs[3].id}&select=song_id`)
          ).json()) as unknown[]
        ).length
      )
      .toBe(1)
  })

  test('Likes: the reviews they liked, as feed cards', async ({ page }) => {
    const theirText = 'A lovely slow build that pays off in the last minute, quietly and completely.'
    const [review] = (await (
      await adminFetch('/rest/v1/reviews', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: friend.id, song_id: songs[5].id, rating: 4, body: theirText }),
      })
    ).json()) as { id: string }[]
    await adminFetch('/rest/v1/review_likes', {
      method: 'POST',
      body: JSON.stringify({ user_id: owner.id, review_id: review.id }),
    })

    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}?tab=likes`)
    await page.getByRole('button', { name: 'Reviews', exact: true }).click()
    await expect(page.getByText(theirText)).toBeVisible()
  })

  test('Playlists: the New playlist tile makes one', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}?tab=playlists`)
    await page.getByRole('button', { name: 'Create a playlist' }).or(page.getByRole('button', { name: 'New playlist' })).first().click()
    const dialog = page.getByRole('dialog', { name: 'New playlist' })
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Profile test mix')
    await dialog.getByRole('button', { name: 'Create playlist' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Profile test mix/ })).toBeVisible()
  })

  test('a private profile shows its header and counts, and a lock card instead of the tabs', async ({
    page,
  }) => {
    const priv = await createTestUser('prof-private')
    await setPrivate(priv.id, true)
    await ratingOnly(priv.id, songs[2].id, 4)

    await login(page, owner.email)
    await page.goto(`/profile/${priv.id}?tab=likes`)
    await expect(page.getByText('This account is private. Follow to see their reviews, playlists and stats.')).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '1 rating', exact: true })).toBeVisible()
    // The written count isn't shown where it can't be counted.
    await expect(page.getByRole('button', { name: /^\d+ reviews?$/ })).toHaveCount(0)
    // One follow button, in the lock card.
    await expect(page.getByRole('main').getByRole('button', { name: 'Follow', exact: true })).toHaveCount(1)
  })

  test('tabs and counts are at least 44px tall', async ({ page }) => {
    await login(page, owner.email)
    await page.goto(`/profile/${owner.id}`)
    for (const t of ['Reviews', 'Playlists', 'Stats', 'Likes']) {
      const box = await tab(page, t).boundingBox()
      expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
    }
    const count = await page.getByRole('button', { name: '1 follower', exact: true }).boundingBox()
    expect(Math.round(count!.height)).toBeGreaterThanOrEqual(44)
  })
})
