import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  adminFetch,
  createTestUser,
  deleteSeededCatalog,
  deleteTestUsers,
  env,
  login,
  tokenFor,
} from './helpers'

/**
 * The daily check-in (#9) and the song of the week (#10). Labels for the
 * picks are test rows on e2e- songs; real labelled songs may also be
 * picked, so checks look at what was asked for (the tags), not at titles.
 */

const tag = Date.now().toString(36).slice(-4)
const stamp = `e2e-mw-${tag}`

async function seedLabelledSongs() {
  const insert = async (path: string, body: unknown) =>
    (await (await adminFetch(path, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) })).json()) as { id: string }[]
  const [artist] = await insert('/rest/v1/artists', { spotify_id: `${stamp}-artist`, name: `MW Artist ${tag}` })
  const [album] = await insert('/rest/v1/albums', {
    spotify_id: `${stamp}-album`, title: `MW Album ${tag}`, artist_id: artist.id, release_date: '2020-01-01', total_tracks: 3, album_type: 'album',
  })
  const songs = await insert(
    '/rest/v1/songs',
    ['one', 'two', 'three'].map((n, i) => ({
      spotify_id: `${stamp}-${n}`, title: `Slow Sad ${n} ${tag}`, artist_id: artist.id, album_id: album.id,
      duration_ms: 180000, track_number: i + 1, disc_number: 1,
    }))
  )
  await adminFetch('/rest/v1/song_vibes', {
    method: 'POST',
    body: JSON.stringify(songs.map((s) => ({ song_id: s.id, lyrics_mood: 'sad', energy: 'low', confidence: 0.9, has_lyrics: true, model: 'test' }))),
  })
  return songs
}

const card = (page: Page) => page.getByRole('region', { name: 'Your daily check-in' })

async function answer(c: Locator, labels: string[]) {
  for (const l of labels) await c.getByRole('button', { name: l, exact: true }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await seedLabelledSongs()
})

test.afterAll(async () => {
  await deleteTestUsers()
  await deleteSeededCatalog()
})

test('the check-in: four questions with Back, then a song that fits, Ask me about it, Show another and Start over', async ({ page }) => {
  const me = await createTestUser('mw-flow')
  await login(page, me.email)
  const c = card(page)
  await expect(c.getByText("4 quick taps and I'll find your song for today")).toBeVisible()
  await c.getByRole('button', { name: "Let's go" }).click()

  await expect(c.getByText('Question 1 of 4')).toBeVisible()
  await c.getByRole('button', { name: 'Happy', exact: true }).click()
  await expect(c.getByText('Question 2 of 4')).toBeVisible()
  // Back keeps the earlier answer.
  await c.getByRole('button', { name: 'Back' }).click()
  await expect(c.getByRole('button', { name: 'Happy', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await answer(c, ['Sad', 'Match how I feel', 'Slow and soft', 'Surprise me'])

  await expect(c.getByText("Here's what I found for you.")).toBeVisible()
  const tags = c.getByRole('list', { name: 'About this song' })
  await expect(tags).toContainText('Sad lyrics')
  await expect(tags).toContainText('Slow beat')
  await expect(c.getByText(/Why this one:/)).toBeVisible()
  const first = await c.getByRole('link').first().textContent()

  await c.getByRole('button', { name: 'Ask me about it' }).click()
  const ask = page.getByRole('dialog', { name: 'Ask Beatie' })
  await expect(ask).toBeVisible()
  await expect(ask.getByText(first ?? '')).toBeVisible()
  await page.keyboard.press('Escape')

  await c.getByRole('button', { name: 'Not feeling it? Show another' }).click()
  await expect(c.getByText("Here's what I found for you.")).toBeVisible()
  await expect(c.getByRole('link').first()).not.toHaveText(first ?? '')

  // Stored once for today, with both songs shown and the first passed on.
  const rows = (await (await adminFetch(`/rest/v1/mood_checkins?user_id=eq.${me.id}&select=shown,passed,answers`)).json()) as {
    shown: string[]; passed: string[]; answers: { feeling: string }
  }[]
  expect(rows).toHaveLength(1)
  expect(rows[0].shown).toHaveLength(2)
  expect(rows[0].passed).toHaveLength(1)
  expect(rows[0].answers.feeling).toBe('sad')

  await c.getByRole('button', { name: 'Start over' }).click()
  await expect(c.getByText('Question 1 of 4')).toBeVisible()
})

test('after the check-in Home shows "Today: <song>", which reopens it', async ({ page }) => {
  const me = await createTestUser('mw-bar')
  await login(page, me.email)
  const c = card(page)
  await c.getByRole('button', { name: "Let's go" }).click()
  await answer(c, ['Sad', 'Match how I feel', 'Slow and soft', 'Surprise me'])
  await expect(c.getByText("Here's what I found for you.")).toBeVisible()

  await page.reload()
  const bar = page.getByRole('button', { name: /^Today:/ })
  await expect(bar).toBeVisible()
  await expect(c.getByRole('button', { name: "Let's go" })).toHaveCount(0)
  await bar.click()
  await expect(c.getByText("Here's what I found for you.")).toBeVisible()
})

test('"Not today" hides it until tomorrow', async ({ page }) => {
  const me = await createTestUser('mw-skip')
  await login(page, me.email)
  await card(page).getByRole('button', { name: 'Not today' }).click()
  await expect(page.getByText("No problem. I'll ask again tomorrow.")).toBeVisible()
  await expect(card(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Song of the week' })).toBeVisible()
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Today:/ })).toHaveCount(0)
})

test('when nothing fits it says so honestly', async ({ page }) => {
  const me = await createTestUser('mw-none')
  await login(page, me.email)
  await page.route('**/rest/v1/rpc/pick_checkin_song', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  const c = card(page)
  await c.getByRole('button', { name: "Let's go" }).click()
  await answer(c, ['Stressed', 'Help me focus', 'Upbeat', 'Artists I already love'])
  await expect(c.getByText("I couldn't find a good match today.")).toBeVisible()
  await expect(c.getByRole('link')).toHaveCount(0)
})

test('the song of the week: card on Home, the page, and a star tap that keeps your written review', async ({ page }) => {
  const me = await createTestUser('mw-week')
  const token = await tokenFor(me.email)
  const weekly = (await (await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/current_weekly_song`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })).json()) as { song_id: string }[]
  const songId = weekly[0].song_id
  await adminFetch('/rest/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({ user_id: me.id, song_id: songId, rating: 2, title: 'Kept', body: 'These words must survive a star tap.' }),
  })

  await login(page, me.email)
  // Already rated, so it starts folded into the tab row; the small record opens it.
  await page.getByRole('button', { name: /^Song of the week, (\d+ days left|last day|\d+ hours left|less than an hour left)$/ }).click()
  const weekCard = page.getByRole('region', { name: 'Song of the week' })
  await expect(weekCard.getByText('Song of the week')).toBeVisible()
  await expect(weekCard.getByText(/^(\d+ days left|last day|\d+ hours left|less than an hour left)$/)).toBeVisible()
  await weekCard.getByRole('link', { name: 'You rated it 2★' }).click()
  await page.waitForURL(/\/week$/)

  await expect(page.getByText(/^Song of the week · /)).toBeVisible()
  await expect(page.getByText(/^Chosen (because|from)/)).toBeVisible()
  await expect(page.getByText('You rated it 2 stars')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Ratings by stars' }).getByRole('listitem')).toHaveCount(5)

  await page.getByRole('radio', { name: '4 stars', exact: true }).check({ force: true })
  await expect(page.getByText('You rated it 4 stars')).toBeVisible()
  // The stars change on screen before the save lands; wait for the save.
  await expect
    .poll(async () => {
      const [row] = (await (await adminFetch(`/rest/v1/reviews?user_id=eq.${me.id}&song_id=eq.${songId}&select=rating,body,title`)).json()) as {
        rating: number; body: string; title: string
      }[]
      return row
    })
    .toEqual({ rating: 4, body: 'These words must survive a star tap.', title: 'Kept' })

  // "Edit your review" opens the composer on this song, with the text.
  await page.getByRole('button', { name: 'Edit your review' }).click()
  await expect(page.getByLabel('Your review')).toHaveValue('These words must survive a star tap.')
})
