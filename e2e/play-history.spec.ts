import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  audioTime,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  goExplore,
  login,
  pauseAudio,
  playHistoryRows,
  rail,
  railSongIds,
  stubPreviewAudio,
  waitForPlaying,
  type PlayableSong,
} from './helpers'

/**
 * Explore's Recently viewed rail (it was Home's Continue Listening). It
 * merges songs the user opened (song_views) and songs they played
 * (play_history), newest first, each once. Plays are recorded only past the
 * 5-second bar, and every play starts from the beginning — there is no
 * resume point any more.
 *
 * The audio is a stubbed silent clip (see stubPreviewAudio), so the only
 * variable is our own play accounting.
 */
test.describe('recently viewed and play history', () => {
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    songs = await distinctSongs(3)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  async function expectRailIds(page: Page, ids: string[]) {
    await expect(rail(page, 'Recently viewed')).toBeVisible()
    await expect.poll(() => railSongIds(page, 'Recently viewed')).toEqual(ids)
  }

  /** Plays the song page's preview for roughly this long, then pauses. */
  async function playFor(page: Page, song: PlayableSong, ms: number) {
    await page.goto(`/song/${song.id}`)
    await page.getByRole('button', { name: /^Play preview$/ }).click()
    // Wait for audio to actually start; a click alone proves nothing.
    await waitForPlaying(page)
    await page.waitForTimeout(ms)
    await pauseAudio(page)
  }

  async function seed(table: 'song_views' | 'play_history', userId: string, songId: string, minutesAgo: number) {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString()
    const res = await adminFetch(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: userId,
        song_id: songId,
        [table === 'song_views' ? 'viewed_at' : 'played_at']: at,
      }),
    })
    expect(res.status).toBeLessThan(300)
  }

  test('hides the rail for a user who has opened and played nothing', async ({ page }) => {
    const fresh = await createTestUser('rv-empty')
    await login(page, fresh.email)
    await page.goto('/explore')

    // Trending proves the rails rendered, so an absent rail is a real absence
    // rather than a page that simply hasn't loaded yet.
    await expect(rail(page, 'Trending')).toBeVisible()
    await expect(rail(page, 'Recently viewed')).toHaveCount(0)
  })

  test('combines opened and played songs, newest first, without duplicates', async ({
    page,
  }) => {
    const user = await createTestUser('rv-merge')
    const [opened, played, both] = songs

    // Only opened, 30 min ago. Only played, 20 min ago. And one song that was
    // opened 40 min ago and played 10 min ago — it must appear once, at its
    // newer time.
    await seed('song_views', user.id, opened.id, 30)
    await seed('play_history', user.id, played.id, 20)
    await seed('song_views', user.id, both.id, 40)
    await seed('play_history', user.id, both.id, 10)

    await login(page, user.email)
    await page.goto('/explore')
    await expectRailIds(page, [both.id, played.id, opened.id])

    // Opening a song's page moves it to the front, with no reload of Explore.
    await page.goto(`/song/${opened.id}`)
    await expect(page.getByRole('heading', { name: opened.title })).toBeVisible()
    await goExplore(page)
    await expectRailIds(page, [opened.id, both.id, played.id])
  })

  test('counts a play past the threshold and ignores a quick skip', async ({ page }) => {
    const user = await createTestUser('rv-plays')
    await stubPreviewAudio(page, songs)
    await login(page, user.email)

    // A real listen: comfortably past the 5-second bar.
    await playFor(page, songs[0], 7000)
    await expect.poll(async () => (await playHistoryRows(user.id)).map((r) => r.song_id)).toEqual([
      songs[0].id,
    ])

    // A skip: 2 seconds isn't listening, and leaves no play row.
    await playFor(page, songs[1], 2000)
    await page.waitForTimeout(1000)
    expect((await playHistoryRows(user.id)).map((r) => r.song_id)).toEqual([songs[0].id])

    // The rail still lists it, because it was opened — just not as a play.
    await goExplore(page)
    await expectRailIds(page, [songs[1].id, songs[0].id])
  })

  test('playing again starts from the beginning', async ({ page }) => {
    const user = await createTestUser('rv-restart')
    await stubPreviewAudio(page, songs)
    await login(page, user.email)
    const [song] = songs

    // Listen to about 0:08 and stop.
    await playFor(page, song, 8000)
    expect(await audioTime(page)).toBeGreaterThan(5)

    // A fresh page, so nothing is held in memory, then play it from the
    // Recently viewed rail: it starts at 0:00, not where it stopped.
    await page.goto('/explore')
    await expectRailIds(page, [song.id])
    await rail(page, 'Recently viewed')
      .getByRole('button', { name: `Play ${song.title}` })
      .click()
    await waitForPlaying(page)
    expect(await audioTime(page)).toBeLessThan(3)
  })
})
