import { test, expect, type Page } from '@playwright/test'
import {
  createPlaylistWithSongs,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  stubPreviewAudio,
  waitForPlaying,
  type PlayableSong,
} from './helpers'

/**
 * The bar's own controls. Previous used to live only on Now Playing, and
 * there was no way to put the player away short of a reload.
 */
test.describe('mini player controls', () => {
  let user: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    user = await createTestUser('mini')
    songs = await distinctSongs(2)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  const bar = (page: Page) => page.locator('a[href="/now-playing"]').first()

  test('steps back with Previous and closes with the X', async ({ page }) => {
    await stubPreviewAudio(page, songs)
    await login(page, user.email)
    const id = await createPlaylistWithSongs(user.id, 'Bar Controls', [
      songs[0].id,
      songs[1].id,
    ])

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()
    await waitForPlaying(page)
    await expect(bar(page)).toContainText(songs[0].title)

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(bar(page)).toContainText(songs[1].title)

    // Promptly, so this is a step back rather than a restart — Previous
    // restarts the current song once it's more than 3 seconds in.
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(bar(page)).toContainText(songs[0].title)

    // Closing puts the bar away and stops the audio with it.
    await page.getByRole('button', { name: 'Close player' }).click()
    await expect(bar(page)).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const list =
            (window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? []
          return list.every((a) => a.paused)
        })
      )
      .toBe(true)

    // And it stays gone across a navigation, rather than reappearing.
    await page.goto('/library')
    await expect(bar(page)).toHaveCount(0)
  })
})
