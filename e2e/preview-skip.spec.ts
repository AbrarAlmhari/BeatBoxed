import { test, expect, type Page } from '@playwright/test'
import {
  createPlaylistWithSongs,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  pauseAudio,
  stubPreviewAudio,
  type PlayableSong,
} from './helpers'

/**
 * A song with no preview used to leave the player stuck on it. These drive
 * the real queue with the iTunes lookup stubbed per song, so "no preview"
 * is the app's own code path rather than a flag the test sets.
 */
test.describe('songs with no preview', () => {
  let user: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    user = await createTestUser('skip')
    songs = await distinctSongs(3)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  /** What the mini player is currently showing. */
  const miniPlayer = (page: Page) => page.locator('a[href="/now-playing"]').first()

  test('announces the missing preview and moves on by itself', async ({ page }) => {
    // First song unplayable, second fine.
    await stubPreviewAudio(page, songs, [songs[0].id])
    await login(page, user.email)
    const id = await createPlaylistWithSongs(user.id, 'Skip One', [
      songs[0].id,
      songs[1].id,
    ])

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()

    await expect(miniPlayer(page)).toContainText(
      `No preview for ${songs[0].title} — skipping`
    )
    // Nobody pressed anything: the player moves on by itself.
    await expect(miniPlayer(page)).toContainText(songs[1].title)
    await pauseAudio(page)
  })

  test('stops with a message when nothing left in the queue is playable', async ({
    page,
  }) => {
    await stubPreviewAudio(page, songs, [songs[0].id, songs[1].id])
    await login(page, user.email)
    const id = await createPlaylistWithSongs(user.id, 'Skip All', [
      songs[0].id,
      songs[1].id,
    ])

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()

    await expect(miniPlayer(page)).toContainText(
      'No previews available for the rest of this list.'
    )

    // And it stays stopped rather than cycling round the queue again.
    await page.waitForTimeout(3000)
    await expect(miniPlayer(page)).toContainText(
      'No previews available for the rest of this list.'
    )
  })

  test('Next and Previous still work while a song is failing', async ({ page }) => {
    // Middle song unplayable, the ones either side fine.
    await stubPreviewAudio(page, songs, [songs[1].id])
    await login(page, user.email)
    const id = await createPlaylistWithSongs(user.id, 'Skip Middle', [
      songs[0].id,
      songs[1].id,
      songs[2].id,
    ])

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()
    await expect(miniPlayer(page)).toContainText(songs[0].title)

    // Previous only exists on Now Playing — the mini player bar has Play and
    // Next and nothing else — so the rest of this runs there. The mini player
    // stays mounted underneath, so Next and the notice both appear twice;
    // .first() is the Now Playing copy, which precedes it in the DOM.
    await miniPlayer(page).click()
    const nowPlaying = page.getByRole('heading', { level: 1 })
    await expect(nowPlaying).toHaveText(songs[0].title)

    // Into the failing song.
    await page.getByRole('button', { name: 'Next' }).first().click()
    await expect(
      page.getByText(`No preview for ${songs[1].title} — skipping`).first()
    ).toBeVisible()

    // Next during the countdown goes immediately, without waiting it out.
    await page.getByRole('button', { name: 'Next' }).first().click()
    await expect(nowPlaying).toHaveText(songs[2].title)

    // Previous walks back through the failing song the same way, landing on
    // the playable one before it rather than stalling in the middle.
    await page.getByRole('button', { name: 'Previous' }).first().click()
    await expect(nowPlaying).toHaveText(songs[0].title)
    await pauseAudio(page)
  })

  test('a single song played on its own does not skip anywhere', async ({ page }) => {
    await stubPreviewAudio(page, songs, [songs[0].id])
    await login(page, user.email)

    await page.goto(`/song/${songs[0].id}`)
    await page.getByRole('button', { name: /^Play preview$/ }).click()

    // There's no queue to move through, so it keeps the dead-end treatment.
    await expect(miniPlayer(page)).toContainText('Preview unavailable')
    await page.waitForTimeout(3000)
    await expect(miniPlayer(page)).toContainText(songs[0].title)
    await expect(miniPlayer(page)).toContainText('Preview unavailable')
  })
})
