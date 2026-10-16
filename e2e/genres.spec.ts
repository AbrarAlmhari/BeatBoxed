import { test, expect } from '@playwright/test'
import {
  adminFetch,
  createTestUser,
  deleteSeededCatalog,
  deleteTestUsers,
  login,
  seedArtistWithAlbum,
  type SeededArtist,
} from './helpers'

/**
 * Artist genres (Part C): genres are the artist's, grouped into buckets in
 * the database; the Stats tab's Top genres counts only songs rated 3★+;
 * the profile header shows the top three once there are 5+ ratings; songs
 * carry no genre tag anywhere.
 *
 * Uses seeded test artists (e2e- prefix) with genres set directly, so no
 * real artist's genres are touched and nothing calls Wikidata.
 */

type User = { id: string; email: string }

async function setGenres(artistId: string, raw: string[]) {
  await adminFetch(`/rest/v1/artists?id=eq.${artistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ genres_raw: raw, genres_source: 'wikidata', genres_fetched_at: new Date().toISOString() }),
  })
}

async function rate(userId: string, ratings: [string, number][]) {
  await adminFetch('/rest/v1/reviews', {
    method: 'POST',
    body: JSON.stringify(ratings.map(([songId, rating]) => ({ user_id: userId, song_id: songId, rating }))),
  })
}

const genreRow = (page: import('@playwright/test').Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label.replace(/[&]/g, '\\$&')}: `) })

test.describe('artist genres', () => {
  let jazz: SeededArtist
  let metal: SeededArtist
  let fan: User

  test.beforeAll(async () => {
    jazz = await seedArtistWithAlbum('genre-jazz')
    metal = await seedArtistWithAlbum('genre-metal')
    await setGenres(jazz.id, ['jazz', 'bebop', 'soul music'])
    await setGenres(metal.id, ['heavy metal'])
    await setGenres(metal.featureArtistId, ['heavy metal'])
    await setGenres(jazz.featureArtistId, ['jazz'])

    fan = await createTestUser('genre-fan')
    // Jazz: three songs rated 4–5★. Metal: three songs rated 1–2★, which
    // must not count toward genres.
    await rate(fan.id, [
      [jazz.tracks[0].id, 5],
      [jazz.tracks[1].id, 4],
      [jazz.tracks[2].id, 4],
      [metal.tracks[0].id, 1],
      [metal.tracks[1].id, 2],
      [metal.tracks[2].id, 2],
    ])
  })

  test.afterAll(async () => {
    await deleteTestUsers()
    await deleteSeededCatalog()
  })

  test("only 3★+ ratings count toward genres, and a genre row opens its artists", async ({ page }) => {
    await login(page, fan.email)
    await page.goto(`/profile/${fan.id}?tab=stats`)

    await expect(page.getByRole('heading', { name: 'Top genres' })).toBeVisible()
    const row = genreRow(page, 'Jazz & Blues')
    await expect(row).toBeVisible()
    await expect(row).toHaveAccessibleName(/^Jazz & Blues: 3 songs, average 4\.3 stars/)
    // Metal was only ever rated 1–2★.
    await expect(genreRow(page, 'Metal')).toHaveCount(0)

    // The artists show on tap; rows are 44px+.
    const box = await row.boundingBox()
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const artists = row.locator('xpath=following-sibling::div[1]')
    await expect(artists.getByText(jazz.name, { exact: true })).toBeVisible()
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  })

  test('the header shows top genres only with 5+ ratings, and a chip opens Stats', async ({ page }) => {
    await login(page, fan.email)
    await page.goto(`/profile/${fan.id}`)
    const chips = page.getByRole('list', { name: 'Top genres' })
    await expect(chips.getByRole('button', { name: 'Jazz & Blues' })).toBeVisible()
    await chips.getByRole('button', { name: 'Jazz & Blues' }).click()
    await expect(page).toHaveURL(/tab=stats/)

    // Three ratings: no chips.
    const few = await createTestUser('genre-few')
    await rate(few.id, jazz.tracks.map((t) => [t.id, 5] as [string, number]))
    await page.goto(`/profile/${few.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.getByRole('list', { name: 'Top genres' })).toHaveCount(0)
  })

  test("the artist page shows its genres as chips; songs show no genre", async ({ page }) => {
    await login(page, fan.email)
    await page.goto(`/artist/${jazz.id}`)
    await expect(page.getByRole('list', { name: 'Genres' }).getByText('Jazz & Blues')).toBeVisible()

    await page.goto(`/song/${jazz.tracks[0].id}`)
    await expect(page.getByRole('region', { name: 'About' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'About' }).getByText('Genre', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Not tagged', { exact: false })).toHaveCount(0)
  })
})
