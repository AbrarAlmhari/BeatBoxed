import { test, expect, type Page } from '@playwright/test'
import {
  createPlaylistWithSongs,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  logout,
  pngBytes,
  tokenFor,
  tryCoverUpload,
  type PlayableSong,
} from './helpers'

/**
 * Custom covers, end to end through the real upload path: the file is a
 * genuine PNG, squared and re-encoded in the browser before it goes up, so
 * these exercise the image pipeline rather than a stubbed URL.
 */
test.describe('playlist covers', () => {
  let owner: { id: string; email: string }
  let other: { id: string; email: string }
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    owner = await createTestUser('cover-owner')
    other = await createTestUser('cover-other')
    songs = await distinctSongs(2)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  /** The cover image element on the playlist page, if a custom one is set. */
  const customCover = (page: Page) =>
    page.locator('img[src*="playlist-covers"]')

  async function uploadCover(page: Page, playlistId: string) {
    await page.goto(`/playlist/${playlistId}`)
    await page
      .locator('input[aria-label="Playlist cover image"]')
      .setInputFiles({
        name: 'cover.png',
        mimeType: 'image/png',
        buffer: pngBytes(),
      })
    await expect(page.getByText('Cover updated')).toBeVisible()
  }

  test('upload shows on the playlist page, Library and Profile after a refresh', async ({
    page,
  }) => {
    await login(page, owner.email)
    const id = await createPlaylistWithSongs(owner.id, 'Cover Test', [songs[0].id])

    await uploadCover(page, id)

    // Survives a reload, so it came from the stored URL and not local state.
    await page.reload()
    await expect(customCover(page).first()).toBeVisible()

    await page.goto('/library')
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(customCover(page).first()).toBeVisible()

    await page.goto(`/profile/${owner.id}`)
    await page.getByRole('button', { name: 'Playlists' }).click()
    await expect(customCover(page).first()).toBeVisible()
  })

  test('removing the cover brings the artwork grid back', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylistWithSongs(owner.id, 'Removable', [songs[0].id])
    await uploadCover(page, id)

    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('button', { name: /remove cover/i }).click()
    await page.getByRole('button', { name: /save changes/i }).click()

    await page.reload()
    await expect(customCover(page)).toHaveCount(0)
    // The derived artwork is back in its place.
    await expect(page.getByRole('heading', { name: 'Removable' })).toBeVisible()
  })

  test('another user cannot change the cover', async ({ page }) => {
    await login(page, owner.email)
    const id = await createPlaylistWithSongs(owner.id, 'Not Yours', [songs[0].id])
    await uploadCover(page, id)

    await logout(page)
    await login(page, other.email)
    await page.goto(`/playlist/${id}`)

    // The cover is visible to everyone...
    await expect(customCover(page).first()).toBeVisible()
    // ...but none of the controls are.
    await expect(
      page.getByRole('button', { name: 'Change playlist cover' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)

    // And the storage policy refuses them directly, so this isn't just a
    // hidden button.
    const token = await tokenFor(other.email)
    const intoOwnersFolder = await tryCoverUpload(
      token,
      `${owner.id}/${id}.webp`,
      pngBytes()
    )
    expect(
      intoOwnersFolder.status,
      `expected a refusal, got ${intoOwnersFolder.body}`
    ).toBeGreaterThanOrEqual(400)
  })
})
