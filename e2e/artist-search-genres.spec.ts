import { test, expect, type Page } from './fixtures'
import { adminFetch, createTestUser, deleteSeededCatalog, deleteTestUsers, login, seedArtistWithAlbum } from './helpers'

/**
 * Artist cards in search results show up to two of the artist's genre groups,
 * in their short labels. "Other" says nothing about an artist, so it's left off.
 */
const stamp = Date.now()
let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`artist-genres-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
  await deleteSeededCatalog()
})

async function artistWith(label: string, raw: string[]) {
  const artist = await seedArtistWithAlbum(label)
  const res = await adminFetch(`/rest/v1/artists?id=eq.${artist.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ genres_raw: raw, genres_source: 'wikidata', genres_fetched_at: new Date().toISOString() }),
  })
  expect(res.ok).toBe(true)
  return artist
}

async function search(page: Page, name: string) {
  await page.goto('/explore')
  await page.getByRole('searchbox', { name: 'Search' }).fill(name)
  const link = page.getByRole('link', { name, exact: true })
  await expect(link).toBeVisible()
  return link.locator('..')
}

test('shows two short genre labels', async ({ page }, info) => {
  const artist = await artistWith(`GenreTwo${info.project.name}${stamp}`, ['hip hop music', 'k-pop', 'k-pop', 'hip-hop'])
  await login(page, user.email)
  const card = await search(page, artist.name)
  const labels = card.locator('[data-artist-genres] > span')
  await expect(labels).toHaveCount(2)
  expect((await labels.allInnerTexts()).sort()).toEqual(['Hip-Hop', 'K-Pop'])
})

test('leaves "Other" off, and shows nothing for an artist with no genres', async ({ page }, info) => {
  const other = await artistWith(`GenreOther${info.project.name}${stamp}`, ['christian music'])
  const none = await seedArtistWithAlbum(`GenreNone${info.project.name}${stamp}`)
  await login(page, user.email)
  for (const artist of [other, none]) {
    const card = await search(page, artist.name)
    await expect(card.locator('[data-artist-genres]')).toHaveCount(0)
  }
})
