import { test, expect } from '@playwright/test'
import {
  adminFetch,
  awaitFollowWrite,
  createTestUser,
  miniPlayer,
  deleteSeededCatalog,
  deleteTestUsers,
  fanOutRelease,
  followArtistAs,
  login,
  notificationsOf,
  seedArtistWithAlbum,
  seedNewRelease,
  settingsOf,
  stubPreviewAudio,
  waitForPlaying,
  type SeededArtist,
} from './helpers'

/**
 * Artist and album pages, the links into them, and release notifications.
 *
 * The catalog is seeded rather than synced from Spotify: these pages read
 * our own tables, so seeding keeps the tests deterministic and off a
 * rate-limited API whose catalog changes under us.
 */
test.describe('artist and album pages', () => {
  let user: { id: string; email: string }
  let other: { id: string; email: string }
  let seeded: SeededArtist

  test.beforeAll(async () => {
    user = await createTestUser('artist-user')
    other = await createTestUser('artist-other')
    await deleteSeededCatalog()
    seeded = await seedArtistWithAlbum('A')
  })

  test.afterAll(async () => {
    await deleteSeededCatalog()
    await deleteTestUsers()
  })

  // Imported rather than re-declared: the bar now has two /now-playing
  // links, so the old `.first()` locator picked the textless cover.

  test('the artist page shows header, top songs and discography', async ({ page }) => {
    await login(page, user.email)
    await page.goto(`/artist/${seeded.id}`)

    await expect(page.getByRole('heading', { name: seeded.name })).toBeVisible()
    await expect(page.getByText(/followers? on Beatboxed/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: /follow this artist|unfollow this artist/i })
    ).toBeVisible()

    // Top songs come from our catalog by popularity, since Spotify's
    // top-tracks is 403 for this app.
    await expect(page.getByRole('link', { name: seeded.tracks[0].title })).toBeVisible()

    // Discography, and the album opens.
    await expect(page.getByRole('link', { name: new RegExp(seeded.albumTitle) })).toBeVisible()
    await page.getByRole('link', { name: new RegExp(seeded.albumTitle) }).click()
    await page.waitForURL(new RegExp(`/album/${seeded.albumId}`))
  })

  test('an artist with no Wikipedia match shows no bio', async ({ page }) => {
    await login(page, user.email)
    await page.goto(`/artist/${seeded.id}`)
    await expect(page.getByRole('heading', { name: seeded.name })).toBeVisible()

    // A seeded artist has no bio and no Wikidata entry, so About is absent
    // entirely rather than showing someone else's article.
    await expect(page.getByRole('heading', { name: 'About' })).toHaveCount(0)
    await expect(page.getByText('From Wikipedia')).toHaveCount(0)
  })

  test('following on the artist page shows on the song page, and back', async ({
    page,
  }) => {
    await login(page, user.email)
    const follow = page.getByRole('button', {
      name: /follow this artist|unfollow this artist/i,
    })

    await page.goto(`/artist/${seeded.id}`)
    await expect(follow).toHaveText(/^Follow$/)

    // The label is optimistic, and page.goto below is a hard navigation that
    // would abort the still-in-flight insert, so wait for it to land.
    await awaitFollowWrite(page, 'POST', () => follow.click())
    await expect(follow).toHaveText(/Following/)

    // The same artist on one of their song pages already knows.
    await page.goto(`/song/${seeded.tracks[0].id}`)
    await expect(follow).toHaveText(/Following/)

    // Unfollowing there is reflected back on the artist page.
    await awaitFollowWrite(page, 'DELETE', () => follow.click())
    await expect(follow).toHaveText(/^Follow$/)
    await page.goto(`/artist/${seeded.id}`)
    await expect(follow).toHaveText(/^Follow$/)
  })

  test('artist names link through from the song page, and the album too', async ({
    page,
  }) => {
    await login(page, user.email)
    await page.goto(`/song/${seeded.tracks[0].id}`)

    // Album title in the About section.
    await expect(
      page.getByRole('link', { name: seeded.albumTitle })
    ).toBeVisible()

    // The cover is a link to the same album.
    await page.getByRole('link', { name: 'Open album' }).click()
    await page.waitForURL(new RegExp(`/album/${seeded.albumId}`))

    // And the artist name goes to the artist page.
    await page.goto(`/song/${seeded.tracks[0].id}`)
    await page.getByRole('link', { name: seeded.name }).first().click()
    await page.waitForURL(new RegExp(`/artist/${seeded.id}`))
  })

  test('the album lists every track in order, with features named', async ({
    page,
  }) => {
    await login(page, user.email)
    await page.goto(`/album/${seeded.albumId}`)

    await expect(page.getByRole('heading', { name: seeded.albumTitle })).toBeVisible()

    const titles = page.locator('ol li a[href^="/song/"] .text-card-title')
    await expect
      .poll(() => titles.allInnerTexts())
      .toEqual(seeded.tracks.map((t) => t.title))

    // As many rows as Spotify said the album has.
    expect(seeded.tracks).toHaveLength(3)

    // The guest's row names them; the album artist's rows don't repeat it.
    const guestRow = page.locator('ol li').filter({ hasText: seeded.tracks[2].title })
    await expect(guestRow.getByText(seeded.tracks[2].artistName)).toBeVisible()

    // Two discs, so there's a divider.
    await expect(page.getByText('Disc 2')).toBeVisible()

    // The artist name in the header links to the artist page.
    await page.getByRole('link', { name: seeded.name }).first().click()
    await page.waitForURL(new RegExp(`/artist/${seeded.id}`))
  })

  test('Play queues the album in order, and a row starts from that track', async ({
    page,
  }) => {
    await stubPreviewAudio(
      page,
      seeded.tracks.map((t) => ({ id: t.id, title: t.title, artistName: t.artistName }))
    )
    await login(page, user.email)
    await page.goto(`/album/${seeded.albumId}`)

    // Whole album from the top.
    await page.getByRole('button', { name: /^Play$/ }).click()
    await waitForPlaying(page)
    await expect(miniPlayer(page)).toContainText(seeded.tracks[0].title)

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(miniPlayer(page)).toContainText(seeded.tracks[1].title)

    // A row's own play button starts there instead.
    await page.goto(`/album/${seeded.albumId}`)
    await page.getByRole('button', { name: `Play ${seeded.tracks[2].title}` }).click()
    await expect(miniPlayer(page)).toContainText(seeded.tracks[2].title)
  })

  test('a new release notifies followers only, and respects the switch', async ({
    page,
  }) => {
    // `user` follows, `other` does not.
    await followArtistAs(user.id, seeded.id)

    const album = await seedNewRelease(seeded.id, 'A')
    const fan = await fanOutRelease(seeded.id, album.id)
    expect(fan.status).toBeLessThan(400)

    await expect
      .poll(async () =>
        (await notificationsOf(user.id)).filter((n) => n.type === 'artist_release')
      )
      .toHaveLength(1)
    expect(
      (await notificationsOf(other.id)).filter((n) => n.type === 'artist_release')
    ).toHaveLength(0)

    // It renders under the Artists chip and opens the album.
    await login(page, user.email)
    await page.goto('/notifications')
    await page.getByRole('button', { name: 'Artists' }).click()
    await expect(page.getByText(`New release from ${seeded.name}`)).toBeVisible()

    // Only one per user per album, however many times the sync runs.
    await fanOutRelease(seeded.id, album.id)
    expect(
      (await notificationsOf(user.id)).filter((n) => n.type === 'artist_release')
    ).toHaveLength(1)

    // Turning the switch off stops the next one.
    await page.goto('/settings')
    await page
      .getByRole('switch', { name: 'New releases from artists you follow' })
      .click()
    await expect
      .poll(async () => (await settingsOf(user.id)).prefs?.artist_release)
      .toBe(false)

    const second = await seedNewRelease(seeded.id, 'A2')
    await fanOutRelease(seeded.id, second.id)
    await page.waitForTimeout(1000)
    expect(
      (await notificationsOf(user.id)).filter((n) => n.type === 'artist_release')
    ).toHaveLength(1)
  })

  test('caching an old back catalogue notifies nobody', async ({ page }) => {
    await login(page, user.email)

    // A fresh artist, followed, whose albums are all old -- exactly the
    // first-sync case that must stay silent.
    const old = await seedArtistWithAlbum('Old')
    await followArtistAs(user.id, old.id)

    const before = (await notificationsOf(user.id)).filter(
      (n) => n.type === 'artist_release'
    ).length

    // The seeded album is dated 2020, so the fan-out refuses it outright.
    const fan = await fanOutRelease(old.id, old.albumId)
    expect(fan.sent).toBe(0)

    await adminFetch(`/rest/v1/follows?user_id=eq.${user.id}&artist_id=eq.${old.id}`, {
      method: 'DELETE',
    })

    expect(
      (await notificationsOf(user.id)).filter((n) => n.type === 'artist_release')
    ).toHaveLength(before)
  })
})
