import { test, expect } from '@playwright/test'
import {
  audioTime,
  createTestUser,
  deleteTestUsers,
  goHome,
  login,
  pauseAudio,
  playHistoryRows,
  rail,
  railSongIds,
  seekAudio,
  stubPreviewAudio,
  twoDistinctSongs,
  waitForPlaying,
  type PlayableSong,
} from './helpers'

/**
 * Continue Listening is driven by what was actually played, so these tests
 * drive the real player rather than writing play_history directly. The audio
 * is a stubbed silent clip (see stubPreviewAudio) so the only variable is our
 * own play accounting.
 */
test.describe('continue listening', () => {
  let songs: [PlayableSong, PlayableSong]

  test.beforeAll(async () => {
    songs = await twoDistinctSongs()
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  /**
   * Asserts the rail's exact contents, in order. Polls, because reading the
   * card list is a one-shot DOM query and a fresh page load may not have
   * rendered the feed yet.
   */
  async function expectRailIds(
    page: import('@playwright/test').Page,
    ids: string[]
  ) {
    await expect(rail(page, 'Continue Listening')).toBeVisible()
    await expect
      .poll(() => railSongIds(page, 'Continue Listening'))
      .toEqual(ids)
  }

  /** Plays the song page's preview for roughly this long, then pauses. */
  async function playFor(
    page: import('@playwright/test').Page,
    song: PlayableSong,
    ms: number
  ) {
    await page.goto(`/song/${song.id}`)
    const play = page.getByRole('button', { name: /^Play preview$/ })
    await play.click()

    // Wait for audio to actually start; a click alone proves nothing.
    await waitForPlaying(page)
    await page.waitForTimeout(ms)
    await pauseAudio(page)
  }

  test('hides the rail for a user who has played nothing', async ({ page }) => {
    const fresh = await createTestUser('play-empty')
    await login(page, fresh.email)
    await page.goto('/')

    // Trending proves the feed rendered, so an absent rail is a real absence
    // rather than a page that simply hasn't loaded yet.
    await expect(rail(page, 'Trending')).toBeVisible()
    await expect(rail(page, 'Continue Listening')).toHaveCount(0)
    expect(await playHistoryRows(fresh.id)).toHaveLength(0)
  })

  test('lists a song played past the threshold and ignores a quick skip', async ({
    page,
  }) => {
    const user = await createTestUser('play-history')
    await stubPreviewAudio(page, songs)
    await login(page, user.email)

    // 1. A real listen: comfortably past the 5-second bar.
    await playFor(page, songs[0], 7000)

    await goHome(page)
    await expectRailIds(page, [songs[0].id])

    // The resume point was saved on pause, so a tap can pick it back up.
    const afterFirst = await playHistoryRows(user.id)
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0].song_id).toBe(songs[0].id)
    expect(afterFirst[0].position_seconds).toBeGreaterThan(4)

    // 2. A skip: 2 seconds is not listening, and must leave no trace.
    await playFor(page, songs[1], 2000)

    await goHome(page)
    await expectRailIds(page, [songs[0].id])
    expect(await playHistoryRows(user.id)).toHaveLength(1)

    // 3. Playing the skipped song properly puts it in front of the first.
    await playFor(page, songs[1], 7000)

    await goHome(page)
    await expectRailIds(page, [songs[1].id, songs[0].id])
  })

  test('resumes where the user left off, and restarts a finished song', async ({
    page,
  }) => {
    const user = await createTestUser('play-resume')
    await stubPreviewAudio(page, songs)
    await login(page, user.email)
    const [song] = songs
    const playCard = () =>
      rail(page, 'Continue Listening').getByRole('button', {
        name: `Play ${song.title}`,
      })

    // Listen to 0:07 and stop there.
    await playFor(page, song, 7000)

    // Come back in a fresh page, so the player has nothing in memory and the
    // only place 0:07 can come from is the saved row. (Within the same page
    // the card would just un-pause the song that's still loaded.)
    await page.goto('/')
    await expectRailIds(page, [song.id])

    // Tapping the card picks up at 0:07, not 0:00.
    await playCard().click()
    await waitForPlaying(page)
    const resumedAt = await audioTime(page)
    expect(resumedAt).toBeGreaterThan(5)
    expect(resumedAt).toBeLessThan(15)

    // Stop two seconds from the end: close enough to count as finished.
    await seekAudio(page, 28)
    await pauseAudio(page)
    await expect
      .poll(async () => (await playHistoryRows(user.id))[0]?.position_seconds)
      .toBeGreaterThan(27)

    // So the next tap starts over instead of at 0:28.
    await page.goto('/')
    await playCard().click()
    await waitForPlaying(page)
    expect(await audioTime(page)).toBeLessThan(3)

    // Playing to the very end stores 0 outright.
    await seekAudio(page, 29)
    await expect
      .poll(async () => (await playHistoryRows(user.id))[0]?.position_seconds)
      .toBe(0)
  })
})
