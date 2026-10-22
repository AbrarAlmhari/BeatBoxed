import { test, expect } from '@playwright/test'
import { createTestUser, deleteSeededCatalog, deleteTestUsers, login, seedSongs } from './helpers'

/**
 * Arabic search as people type it: without diacritics or tatweel, with
 * أ إ آ as ا and ى as ي (normalize_search_text in 0051 and the app's
 * normalizeSearch must agree, or these songs can't be found).
 */

let user: { id: string; email: string }
let songs: { id: string; title: string }[]

// Each title carries an unusual word, so the search finds this song and not
// a real one that happens to share a common word.
const WITH_DIACRITICS = 'يَا لَيْلُ الزُّمُرُّدِيّ'
const WITH_HAMZA = 'أحمد الفيروزي'
const WITH_ALEF_MAQSURA = 'ليلى الياقوتية'

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`arabic-${info.project.name}`)
  songs = await seedSongs(`arabic-${info.project.name}`, [WITH_DIACRITICS, WITH_HAMZA, WITH_ALEF_MAQSURA])
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
  await deleteSeededCatalog()
})

const cases = [
  { name: 'a title with diacritics, typed without them', title: WITH_DIACRITICS, typed: 'يا ليل الزمردي' },
  { name: '"احمد" finds "أحمد"', title: WITH_HAMZA, typed: 'احمد الفيروزي' },
  { name: '"ليلي" finds "ليلى"', title: WITH_ALEF_MAQSURA, typed: 'ليلي الياقوتية' },
]

for (const c of cases) {
  test(`Explore search: ${c.name}`, async ({ page }) => {
    const song = songs.find((s) => s.title === c.title)!
    await login(page, user.email)
    await page.goto('/explore')
    await page.getByRole('searchbox', { name: 'Search' }).fill(c.typed)
    await expect(page.getByRole('main').locator(`a[href="/song/${song.id}"]`).first()).toBeVisible()
  })
}
