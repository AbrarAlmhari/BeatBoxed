import { test, expect } from '@playwright/test'
import {
  awaitFollowWrite,
  createTestUser,
  deleteTestUsers,
  followButton,
  login,
  logout,
  measureLabelFlip,
  twoSongsBySameArtist,
} from './helpers'

/**
 * Follow state is shared across the whole session, so the thing worth testing
 * is that it stays consistent between pages — not that one button toggles.
 */
test.describe('following an artist', () => {
  let userA: { id: string; email: string }
  let userB: { id: string; email: string }
  let songs: Awaited<ReturnType<typeof twoSongsBySameArtist>>

  test.beforeAll(async () => {
    userA = await createTestUser('follow-a')
    userB = await createTestUser('follow-b')
    songs = await twoSongsBySameArtist()
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('shows on every song by that artist, survives refresh, and clears per user', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await login(page, userA.email)

    // 1. Follow from one song.
    //
    // The label flips optimistically, so asserting it proves nothing about
    // the server. page.goto() below is a full browser navigation and would
    // abort a still-in-flight write, so wait for the POST to land first.
    // (A real user navigating in-app keeps the fetch alive; only a hard
    // navigation cancels it.)
    await page.goto(`/song/${songs.first.id}`)
    await expect(followButton(page)).toHaveText(/^Follow$/)
    const flipMs = await measureLabelFlip(page, () =>
      awaitFollowWrite(page, 'POST', () => followButton(page).click())
    )
    await expect(followButton(page)).toHaveText(/Following/)

    // The label is optimistic, so it must land on the tap itself rather than
    // on the ~200ms write. Measured in-page; it normally comes in under 5ms.
    expect(flipMs, 'the label never changed after the tap').not.toBeNull()
    expect(flipMs!, `label took ${flipMs}ms to flip`).toBeLessThan(100)

    // And nothing may still look pending once the write lands. A spinner here
    // used to run forever, which is what made an instant toggle feel slow.
    await expect(followButton(page).locator('.animate-spin')).toHaveCount(0)

    // 2. A different song by the same artist already knows.
    await page.goto(`/song/${songs.second.id}`)
    await expect(followButton(page)).toHaveText(/Following/)

    // 3. Survives a full reload, so it came from the server not just state.
    await page.reload()
    await expect(followButton(page)).toHaveText(/Following/)

    // 4. Listed exactly once in both places that show followed artists.
    for (const path of [`/profile/${userA.id}/artists`, '/library']) {
      await page.goto(path)
      if (path === '/library') await page.getByRole('button', { name: 'Artists' }).click()
      const named = page.getByText(songs.artistName, { exact: true })
      await expect(named).toHaveCount(1)
    }

    // 5. Unfollow somewhere else; the song page must agree.
    await page.goto('/library')
    await page.getByRole('button', { name: 'Artists' }).click()
    await awaitFollowWrite(page, 'DELETE', () => followButton(page).first().click())
    await expect(followButton(page)).toHaveCount(0)

    await page.goto(`/song/${songs.first.id}`)
    await expect(followButton(page)).toHaveText(/^Follow$/)

    // 6. Nothing carries over to another account.
    await awaitFollowWrite(page, 'POST', () => followButton(page).click())
    await expect(followButton(page)).toHaveText(/Following/)

    await logout(page)
    await login(page, userB.email)
    await page.goto(`/song/${songs.first.id}`)
    await expect(followButton(page)).toHaveText(/^Follow$/)

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0)
  })
})
