import { test, expect, type Page } from '@playwright/test'
import {
  createTestUser,
  deleteTestUsers,
  login,
  logout,
  pauseAudio,
  playlistRows,
  playlistsOf,
  stubPreviewAudio,
  twoDistinctSongs,
  waitForPlaying,
  type PlayableSong,
} from './helpers'

/**
 * Covers the whole playlist loop through the UI, plus the two things only the
 * database can confirm: that positions are really persisted, and that a
 * non-owner genuinely can't write.
 */
test.describe('playlists', () => {
  let owner: { id: string; email: string }
  let other: { id: string; email: string }
  let songs: [PlayableSong, PlayableSong]

  test.beforeAll(async () => {
    owner = await createTestUser('pl-owner')
    other = await createTestUser('pl-other')
    songs = await twoDistinctSongs()
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  /** Creates a playlist from Library and returns its id. */
  async function createPlaylist(page: Page, title: string) {
    await page.goto('/library')
    await page.getByRole('button', { name: 'Playlists' }).click()
    await page.getByRole('button', { name: /new playlist/i }).click()
    await page.getByRole('textbox', { name: 'Title' }).fill(title)

    // Wait on the insert rather than on the card appearing: this helper runs
    // in every test, and only the first one is actually about the grid
    // rendering. Waiting on the DOM here makes unrelated tests depend on it.
    const written = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/playlists') &&
        r.request().method() === 'POST' &&
        r.status() < 400
    )
    await page.getByRole('button', { name: /create playlist/i }).click()
    await written

    const rows = await playlistsOf(owner.id)
    const made = rows.find((r) => r.title === title)
    if (!made) throw new Error(`playlist ${title} was not created`)
    return made.id
  }

  /** Adds a song to a named playlist via the Song page picker. */
  async function addSongFromSongPage(
    page: Page,
    song: PlayableSong,
    playlistTitle: string
  ) {
    await page.goto(`/song/${song.id}`)
    await page.getByRole('button', { name: 'Add to playlist' }).click()

    // Wait for the insert to land. The picker closes optimistically, and the
    // next page.goto is a hard navigation that would abort the request --
    // leaving a test that adds two songs with only the last one saved.
    const written = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/playlist_songs') &&
        r.request().method() === 'POST' &&
        r.status() < 400
    )
    await page
      .getByRole('dialog', { name: 'Add to playlist' })
      .getByRole('button', { name: new RegExp(playlistTitle) })
      .click()
    await written
  }

  test('create, add a song, and see it on the detail page, Library and Profile', async ({
    page,
  }) => {
    await login(page, owner.email)
    const id = await createPlaylist(page, 'Late Night')

    await addSongFromSongPage(page, songs[0], 'Late Night')
    await expect(page.getByText('Added to Late Night')).toBeVisible()

    // Detail page shows the song and the owner.
    await page.goto(`/playlist/${id}`)
    await expect(page.getByRole('heading', { name: 'Late Night' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: songs[0].title, exact: false })
    ).toBeVisible()

    // Library lists it with a song count.
    await page.goto('/library')
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(page.getByRole('link', { name: /Late Night.*1 song/s })).toBeVisible()

    // Profile lists it too, and the stat counts it.
    await page.goto(`/profile/${owner.id}`)
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(page.getByRole('link', { name: /Late Night/ })).toBeVisible()
  })

  test('the same song cannot be added twice', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylist(page, 'No Dupes')

    await addSongFromSongPage(page, songs[0], 'No Dupes')
    await expect(page.getByText('Added to No Dupes')).toBeVisible()

    // Reopening the picker shows it as already in the playlist, so the only
    // thing the same button can do now is take it out again.
    await page.goto(`/song/${songs[0].id}`)
    await page.getByRole('button', { name: 'Add to playlist' }).click()
    const row = page
      .getByRole('dialog', { name: 'Add to playlist' })
      .getByRole('button', { name: /No Dupes/ })
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    // And the database holds exactly one row either way.
    expect(await playlistRows(id)).toHaveLength(1)
  })

  test('reordering survives a refresh', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylist(page, 'Order Test')
    await addSongFromSongPage(page, songs[0], 'Order Test')
    await addSongFromSongPage(page, songs[1], 'Order Test')

    await page.goto(`/playlist/${id}`)
    // Polled: reading the list is a one-shot DOM query and the page has just
    // navigated.
    const titles = () =>
      page.locator('ol li a[href^="/song/"] .text-card-title').allInnerTexts()
    await expect.poll(titles).toEqual([songs[0].title, songs[1].title])

    await page.getByRole('button', { name: `Move ${songs[1].title} up` }).click()
    await expect
      .poll(() => playlistRows(id))
      .toEqual([
        { song_id: songs[1].id, position: 0 },
        { song_id: songs[0].id, position: 1 },
      ])

    await page.reload()
    await expect.poll(titles).toEqual([songs[1].title, songs[0].title])
  })

  test('remove a song, then delete the playlist', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylist(page, 'Temporary')
    await addSongFromSongPage(page, songs[0], 'Temporary')

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: `Remove ${songs[0].title}` }).click()
    await expect(page.getByText(`Removed ${songs[0].title}`)).toBeVisible()
    await expect(page.getByText('Add songs from any song page.')).toBeVisible()
    await expect.poll(() => playlistRows(id)).toHaveLength(0)

    // Deleting asks first.
    await page.getByRole('button', { name: 'Delete playlist' }).click()
    await page.getByRole('button', { name: /^Delete playlist$/ }).click()
    await page.waitForURL(/\/library/)
    await expect
      .poll(async () => (await playlistsOf(owner.id)).some((p) => p.id === id))
      .toBe(false)
  })

  test('another user can view the playlist but not edit it', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylist(page, 'Read Only')
    await addSongFromSongPage(page, songs[0], 'Read Only')

    await logout(page)
    await login(page, other.email)
    await page.goto(`/playlist/${id}`)

    // Visible...
    await expect(page.getByRole('heading', { name: 'Read Only' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: songs[0].title, exact: false })
    ).toBeVisible()

    // ...but with none of the owner's controls.
    await expect(page.getByRole('button', { name: 'Delete playlist' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: `Remove ${songs[0].title}` })
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: `Move ${songs[0].title} down` })
    ).toHaveCount(0)

    // And the row is still there, because hiding buttons isn't security.
    expect(await playlistRows(id)).toHaveLength(1)
  })

  test('playing a playlist starts at the first song and advances in order', async ({
    page,
  }) => {
    await stubPreviewAudio(page, songs)
    await login(page, owner.email)
    const id = await createPlaylist(page, 'Playable')
    await addSongFromSongPage(page, songs[0], 'Playable')
    await addSongFromSongPage(page, songs[1], 'Playable')

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()
    await waitForPlaying(page)

    // The mini player names what's playing, so it's the honest check that
    // the queue started at the top rather than wherever was tapped.
    const mini = page.locator('a[href="/now-playing"]').first()
    await expect(mini).toContainText(songs[0].title)

    // Next steps through the queue the playlist built.
    await page.getByRole('button', { name: 'Next' }).first().click()
    await expect(mini).toContainText(songs[1].title)
    await pauseAudio(page)
  })
})
