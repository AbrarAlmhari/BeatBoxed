import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  goHome,
  login,
  logout,
  makeFollow,
  setPrivate,
  stubPreviewAudio,
  waitForPlaying,
  type PlayableSong,
} from './helpers'

/**
 * Home's review feed (0028) and the "New review" composer.
 *
 * The feed only lists reviews with at least FEED_MIN_CHARS (80) characters of
 * body text, and privacy is enforced in the database, so the visibility tests
 * read what the page shows for different viewers rather than trusting any
 * client-side filter.
 */

type User = { id: string; email: string }

/** Comfortably past 80 characters, and unique per call so text checks are exact. */
let n = 0
function longText(label: string) {
  n += 1
  return `${label} #${n}: the bassline carries the whole song and the chorus lands harder every time it comes back around.`
}

const cards = (page: Page) => page.locator('article[data-review-id]')
const composerDialog = (page: Page) => page.getByRole('dialog', { name: /New review|Edit review/ })

async function openTab(page: Page, name: 'For You' | 'Following') {
  await page.getByRole('tab', { name }).click()
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

/** Waits for the active tab to finish its first load. */
async function feedSettled(page: Page) {
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false')
}

async function openComposer(page: Page) {
  await page.getByRole('button', { name: /what song is on your mind/i }).click()
  const dialog = composerDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

async function searchAndPick(page: Page, song: PlayableSong) {
  const dialog = composerDialog(page)
  await dialog.getByRole('combobox').fill(song.title)
  const option = dialog.getByRole('option', { name: new RegExp(escapeRe(song.title)) }).first()
  await expect(option).toBeVisible({ timeout: 30_000 })
  await option.click()
  await expect(dialog.getByText('Your rating')).toBeVisible()
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Clicks the star the way a person does: the label wrapping that radio. */
async function rate(page: Page, stars: number) {
  const radio = page.getByRole('radio', { name: `${stars} star${stars > 1 ? 's' : ''}`, exact: true })
  await composerDialog(page).locator('label', { has: radio }).click()
  await expect(radio).toBeChecked()
}

test.describe('review composer', () => {
  let songs: PlayableSong[]

  test.beforeAll(async () => {
    songs = await distinctSongs(8)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('search, pick, rate and write: it posts to the top of both tabs and the song page', async ({
    page,
  }) => {
    const me = await createTestUser('fc-post')
    const song = songs[0]
    const text = longText('Posted')
    await login(page, me.email)
    await page.goto('/')
    await feedSettled(page)

    await openComposer(page)
    await searchAndPick(page, song)
    await rate(page, 4)
    await composerDialog(page).getByLabel('Your review').fill(text)
    await composerDialog(page).getByRole('button', { name: 'Post review' }).click()

    // The sheet closes, the toast confirms, and the review leads the feed,
    // briefly outlined.
    await expect(composerDialog(page)).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Review posted' })).toBeVisible()
    const first = cards(page).first()
    await expect(first).toContainText(text)
    await expect(first).toHaveAttribute('data-highlighted', 'true')

    // Top of Following too.
    await openTab(page, 'Following')
    await expect(cards(page).first()).toContainText(text)

    // "View song" opens the song page, where it's listed.
    await page.getByRole('button', { name: 'View song' }).click()
    await page.waitForURL(new RegExp(`/song/${song.id}`))
    await expect(page.getByText(text)).toBeVisible()
  })

  test('Post stays disabled below 80 characters or without a rating', async ({ page }) => {
    const me = await createTestUser('fc-limits')
    await login(page, me.email)
    await page.goto('/')
    await openComposer(page)
    await searchAndPick(page, songs[1])

    const dialog = composerDialog(page)
    const post = dialog.getByRole('button', { name: 'Post review' })
    const textarea = dialog.getByLabel('Your review')

    // 79 characters, with a rating: still off, and the counter says why.
    await rate(page, 5)
    await textarea.fill('x'.repeat(79))
    await expect(dialog.getByTestId('composer-counter')).toHaveText('79 / 80')
    await expect(dialog.getByText('Write a little more so it can appear in the feed')).toBeVisible()
    await expect(post).toBeDisabled()

    // Spaces at the ends don't count, as in the database.
    await textarea.fill(`   ${'x'.repeat(79)}   `)
    await expect(post).toBeDisabled()

    // 80: on, and the hint becomes a quiet check.
    await textarea.fill('x'.repeat(80))
    await expect(post).toBeEnabled()
    await expect(dialog.getByText('Write a little more so it can appear in the feed')).toHaveCount(0)

    // 80 characters but no rating (a fresh draft): off.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
    await openComposer(page)
    await searchAndPick(page, songs[1])
    await composerDialog(page).getByLabel('Your review').fill('x'.repeat(120))
    await expect(composerDialog(page).getByRole('button', { name: 'Post review' })).toBeDisabled()
  })

  test('"Now playing" leads the list when something is playing', async ({ page }) => {
    const me = await createTestUser('fc-playing')
    const song = songs[2]
    await stubPreviewAudio(page, [song])
    await login(page, me.email)

    await page.goto(`/song/${song.id}`)
    await page.getByRole('button', { name: /^Play preview$/ }).click()
    await waitForPlaying(page)
    await goHome(page)

    const dialog = await openComposer(page)
    await expect(dialog.getByText('Now playing', { exact: true })).toBeVisible()
    const firstOption = dialog.getByRole('option').first()
    await expect(firstOption).toContainText(song.title)

    // And it's pickable from the keyboard: down, then Enter.
    await dialog.getByRole('combobox').press('ArrowDown')
    await expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('combobox').press('Enter')
    await expect(dialog.getByText('Your rating')).toBeVisible()
    await expect(dialog).toContainText(song.title)
  })

  test('picking a song already reviewed opens that review for editing', async ({ page }) => {
    const me = await createTestUser('fc-edit')
    const song = songs[3]
    const existing = longText('Existing')
    await createReview(me.id, song.id, 3, existing)
    await login(page, me.email)
    await page.goto('/')

    const dialog = await openComposer(page)
    await dialog.getByRole('combobox').fill(song.title)
    const option = dialog.getByRole('option', { name: new RegExp(escapeRe(song.title)) }).first()
    await expect(option).toContainText('Reviewed', { timeout: 30_000 })
    await option.click()

    await expect(dialog.getByRole('heading', { name: 'Edit review' })).toBeVisible()
    await expect(dialog.getByLabel('Your review')).toHaveValue(existing)
    await expect(dialog.getByRole('radio', { name: '3 stars' })).toBeChecked()

    const edited = longText('Edited')
    await dialog.getByLabel('Your review').fill(edited)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toHaveCount(0)

    // Still one review for that song, now with the new text.
    const rows = (await (
      await adminFetch(`/rest/v1/reviews?user_id=eq.${me.id}&song_id=eq.${song.id}&select=body,edited`)
    ).json()) as { body: string; edited: boolean }[]
    expect(rows).toEqual([{ body: edited, edited: true }])
  })

  test('Change goes back to the search with the typed text kept', async ({ page }) => {
    const me = await createTestUser('fc-change')
    await login(page, me.email)
    await page.goto('/')
    await openComposer(page)
    await searchAndPick(page, songs[4])

    const dialog = composerDialog(page)
    await expect(dialog.getByText(songs[4].title).first()).toBeVisible()
    await dialog.getByRole('button', { name: 'Change' }).click()

    await expect(dialog.getByRole('combobox')).toHaveValue(songs[4].title)
    await expect(dialog.getByRole('combobox')).toBeFocused()
  })

  test('closing with unsaved text asks first', async ({ page }) => {
    const me = await createTestUser('fc-discard')
    await login(page, me.email)
    await page.goto('/')
    await openComposer(page)
    await searchAndPick(page, songs[5])

    const dialog = composerDialog(page)
    await dialog.getByLabel('Your review').fill('Half a thought')

    // Escape asks too; "Keep writing" leaves everything as it was.
    await page.keyboard.press('Escape')
    const confirm = page.getByRole('alertdialog', { name: 'Discard this review?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Keep writing' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(dialog.getByLabel('Your review')).toHaveValue('Half a thought')

    // ✕, then Discard: gone, and the next draft starts empty.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
    await expect(composerDialog(page)).toHaveCount(0)
    await openComposer(page)
    await expect(composerDialog(page).getByRole('combobox')).toHaveValue('')
  })

  test('closing with nothing typed needs no confirmation', async ({ page }) => {
    const me = await createTestUser('fc-clean-close')
    await login(page, me.email)
    await page.goto('/')
    await openComposer(page)
    await composerDialog(page).getByRole('button', { name: 'Close' }).click()
    await expect(composerDialog(page)).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  })
})

test.describe('review feed', () => {
  let songs: PlayableSong[]
  let author: User
  let privateAuthor: User

  test.beforeAll(async () => {
    songs = await distinctSongs(30)
    author = await createTestUser('ff-author')
    privateAuthor = await createTestUser('ff-private')
    await setPrivate(privateAuthor.id, true)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('short and star-only reviews stay out of the feed', async ({ page }) => {
    const viewer = await createTestUser('ff-short-viewer')
    const long = longText('Long enough')
    const short = 'Too short to count.'
    await createReview(author.id, songs[0].id, 5, long)
    await createReview(author.id, songs[1].id, 4, short)
    // Star-only: no body at all.
    await adminFetch('/rest/v1/reviews', {
      method: 'POST',
      body: JSON.stringify({ user_id: author.id, song_id: songs[2].id, rating: 3 }),
    })
    await makeFollow(viewer.id, author.id)

    await login(page, viewer.email)
    await page.goto('/')
    for (const tab of ['Following', 'For You'] as const) {
      await openTab(page, tab)
      await feedSettled(page)
      await expect(page.getByText(long)).toBeVisible()
      await expect(page.getByText(short)).toHaveCount(0)
      await expect(cards(page).filter({ hasText: songs[2].title })).toHaveCount(0)
    }

    // They still count where they always did: the song page lists them.
    await page.goto(`/song/${songs[1].id}`)
    await expect(page.getByRole('region', { name: 'Reviews' }).getByText(short)).toBeVisible()
  })

  test("a private account's review is hidden from non-followers and shown to approved followers", async ({
    page,
  }) => {
    const stranger = await createTestUser('ff-stranger')
    const follower = await createTestUser('ff-approved')
    const visible = longText('Public')
    const hidden = longText('Private')
    await createReview(author.id, songs[3].id, 4, visible)
    await createReview(privateAuthor.id, songs[4].id, 5, hidden)
    await makeFollow(stranger.id, author.id)
    await makeFollow(follower.id, author.id)
    await makeFollow(follower.id, privateAuthor.id, 'accepted')

    // A stranger: the public review proves the feed loaded; the private one
    // is absent on both tabs.
    await login(page, stranger.email)
    await page.goto('/')
    for (const tab of ['For You', 'Following'] as const) {
      await openTab(page, tab)
      await feedSettled(page)
      await expect(page.getByText(visible)).toBeVisible()
      await expect(page.getByText(hidden)).toHaveCount(0)
    }

    // A pending request isn't approval.
    const requester = await createTestUser('ff-pending')
    await makeFollow(requester.id, privateAuthor.id, 'pending')
    await logout(page)
    await login(page, requester.email)
    await page.goto('/?tab=following')
    await feedSettled(page)
    await expect(page.getByText(hidden)).toHaveCount(0)

    // An approved follower sees it on both.
    await logout(page)
    await login(page, follower.email)
    await page.goto('/')
    for (const tab of ['For You', 'Following'] as const) {
      await openTab(page, tab)
      await feedSettled(page)
      await expect(page.getByText(hidden)).toBeVisible()
    }
  })

  test('scrolling to the end loads the next page', async ({ page }) => {
    const prolific = await createTestUser('ff-prolific')
    const viewer = await createTestUser('ff-pager')
    // 25 feed-length reviews: one page of 20, then 5 more.
    for (let i = 0; i < 25; i++) {
      await createReview(prolific.id, songs[5 + i].id, 4, longText(`Paged ${i}`))
    }
    await makeFollow(viewer.id, prolific.id)

    await login(page, viewer.email)
    await page.goto('/?tab=following')
    await feedSettled(page)
    await expect(cards(page)).toHaveCount(20)

    await cards(page).last().scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 4000)
    await expect(cards(page)).toHaveCount(25)

    // No repeats across the page boundary.
    const ids = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-review-id')))
    expect(new Set(ids).size).toBe(25)
  })

  test('an empty Following tab suggests people to follow', async ({ page }) => {
    const loner = await createTestUser('ff-loner')
    // The author has feed-length reviews from the earlier tests and is public.
    await createReview(author.id, songs[29].id, 4, longText('Suggested'))

    await login(page, loner.email)
    await page.goto('/?tab=following')
    await feedSettled(page)
    await expect(page.getByText('Follow people to see their takes here')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Find people' })).toHaveAttribute(
      'href',
      '/explore?filter=people'
    )
    await expect(page.getByRole('button', { name: 'Follow', exact: true }).first()).toBeVisible()
  })
})
