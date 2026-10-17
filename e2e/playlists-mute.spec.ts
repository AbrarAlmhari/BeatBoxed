import { expect, test, type Page } from '@playwright/test'
import {
  adminFetch,
  commentAs,
  createPlaylistWithSongs,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  env,
  login,
  nameUser,
  notificationsOf,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * Liking and saving other people's playlists (#4), and muting people (#5).
 * Privacy and the "muted person can't tell" rules are checked through the
 * API as well as in the app.
 */

const tag = Date.now().toString(36).slice(-4)
type Person = { id: string; email: string; token: string; username: string; name: string }

async function person(role: string, name: string): Promise<Person> {
  const u = await createTestUser(`pm-${role}`)
  const username = `${role}${tag}`.toLowerCase().slice(0, 20)
  await nameUser(u.id, username, name)
  return { ...u, token: await tokenFor(u.email), username, name }
}

/** A table read as a signed-in user, through the same API the app uses. */
async function readAs(token: string, path: string) {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  return { status: res.status, rows: (await res.json()) as unknown[] }
}

async function openProfileMenu(page: Page) {
  await page.getByRole('button', { name: 'More options' }).filter({ visible: true }).first().click()
}

let songs: PlayableSong[]
let me: Person, toji: Person, ory: Person

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  songs = await distinctSongs(6)
  me = await person('pmme', 'Abrar')
  toji = await person('pmtoji', 'Toji')
  ory = await person('pmory', 'ory')
})

test.afterAll(async () => {
  await deleteTestUsers()
})

test("someone else's playlist: like and save, the toast's View opens Library → Saved", async ({ page }) => {
  const id = await createPlaylistWithSongs(toji.id, 'late night drives', songs.slice(0, 4).map((s) => s.id))

  await login(page, me.email)
  await page.goto(`/playlist/${id}`)
  await expect(page.getByRole('heading', { name: 'late night drives' })).toBeVisible()
  await expect(page.getByText('Liked by 0 · Saved by 0')).toBeVisible()

  const like = page.getByRole('button', { name: 'Like this playlist' })
  await like.click()
  await expect(page.getByRole('button', { name: 'Unlike this playlist' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Liked by 1 · Saved by 0')).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Saved to your Library')).toBeVisible()
  await expect.poll(async () => (await notificationsOf(toji.id)).map((n) => n.type)).toEqual(['playlist_liked'])

  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.waitForURL(/\/library\?tab=saved/)
  const saved = page.getByRole('list', { name: 'Saved playlists' })
  await expect(saved.getByRole('link', { name: /late night drives.*Toji · 4 songs/s })).toBeVisible()
})

test('your own playlist shows the counts but no Like or Save', async ({ page }) => {
  const id = await createPlaylistWithSongs(me.id, 'my own mix', [songs[0].id])
  await login(page, me.email)
  await page.goto(`/playlist/${id}`)
  await expect(page.getByText('Liked by 0 · Saved by 0')).toBeVisible()
  await expect(page.getByRole('button', { name: /Like this playlist/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Make private' })).toBeVisible()
})

test('Saved: new songs are counted, a private one becomes "No longer available", a deleted one disappears', async ({ page }) => {
  const id = await createPlaylistWithSongs(ory.id, 'growing list', [songs[1].id])
  const gone = await createPlaylistWithSongs(ory.id, 'about to vanish', [songs[2].id])
  for (const p of [id, gone]) {
    await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/playlist_saves`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: me.id, playlist_id: p }),
    })
  }
  // The owner adds two songs after the save.
  await adminFetch('/rest/v1/playlist_songs', {
    method: 'POST',
    body: JSON.stringify([
      { playlist_id: id, song_id: songs[3].id, position: 1, added_at: new Date(Date.now() + 1000).toISOString() },
      { playlist_id: id, song_id: songs[4].id, position: 2, added_at: new Date(Date.now() + 1000).toISOString() },
    ]),
  })

  await login(page, me.email)
  await page.goto('/library?tab=saved')
  const saved = page.getByRole('list', { name: 'Saved playlists' })
  await expect(saved.getByRole('link', { name: /growing list/ })).toContainText('2 new songs')

  await adminFetch(`/rest/v1/playlists?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ is_private: true }) })
  await adminFetch(`/rest/v1/playlists?id=eq.${gone}`, { method: 'DELETE' })
  await page.reload()
  await expect(saved.getByText('No longer available. The owner made it private.')).toBeVisible()
  await expect(saved.getByText('about to vanish')).toHaveCount(0)
  await saved.getByRole('button', { name: 'Remove' }).click()
  await expect(saved.getByText('No longer available')).toHaveCount(0)
})

test("privacy: an outsider can't like or save a private playlist, in the database", async () => {
  const id = await createPlaylistWithSongs(ory.id, 'only mine', [songs[0].id])
  await adminFetch(`/rest/v1/playlists?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ is_private: true }) })
  for (const table of ['playlist_likes', 'playlist_saves']) {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: me.id, playlist_id: id }),
    })
    expect(res.status, table).toBeGreaterThanOrEqual(400)
  }
  expect((await readAs(me.token, `playlists?id=eq.${id}&select=id`)).rows).toHaveLength(0)
})

test('the Likes tab on a profile lists liked playlists', async ({ page }) => {
  const id = await createPlaylistWithSongs(toji.id, 'liked by abrar', [songs[5].id])
  await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/playlist_likes`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: me.id, playlist_id: id }),
  })
  await login(page, ory.email)
  await page.goto(`/profile/${me.id}`)
  await page.getByRole('tab', { name: 'Likes' }).click()
  await page.getByRole('button', { name: 'Playlists', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Liked playlists' }).getByRole('link', { name: /liked by abrar/ })).toBeVisible()
})

test('mute from the profile: the confirm screen, the toast, the banner, and Unmute', async ({ page }) => {
  await login(page, me.email)

  // Not on your own profile.
  await page.goto(`/profile/${me.id}`)
  await openProfileMenu(page)
  await expect(page.getByRole('button', { name: /^Mute / })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto(`/profile/${toji.id}`)
  await openProfileMenu(page)
  await page.getByRole('button', { name: `Mute @${toji.username}` }).click()
  const sheet = page.getByRole('dialog', { name: 'Mute Toji?' })
  for (const line of [
    "Their reviews won't show in your feeds or Explore.",
    'Their comments are folded away. You can still tap to read one.',
    "You won't get notifications from them.",
    "They won't be told, and you still follow each other.",
  ]) {
    await expect(sheet.getByText(line)).toBeVisible()
  }
  await sheet.getByRole('button', { name: 'Mute', exact: true }).click()
  await expect(page.getByText(`Muted @${toji.username}. Manage muted accounts in Settings.`)).toBeVisible()
  await expect(page.getByText(`You muted @${toji.username}.`)).toBeVisible()
  await expect(page.getByText('Only you can see this.')).toBeVisible()

  // The muted person can't read the mute.
  expect((await readAs(toji.token, `user_mutes?muted_id=eq.${toji.id}`)).rows).toHaveLength(0)

  await page.getByRole('button', { name: 'Unmute', exact: true }).click()
  await expect(page.getByText('Unmuted. Their posts will show again.')).toBeVisible()
})

test("muted: their review leaves the feed, their comments fold, and their own profile still shows the review", async ({ page }) => {
  const review = await createReview(toji.id, songs[1].id, 5, 'A feed-length review by toji for the mute test.')
  const mine = await createReview(me.id, songs[2].id, 4, 'My review that toji comments on.')
  await commentAs(toji.token, mine, toji.id, 'honestly mid')
  await commentAs(ory.token, mine, ory.id, 'the bridge on this one')
  await adminFetch('/rest/v1/user_mutes', { method: 'POST', body: JSON.stringify({ muter_id: me.id, muted_id: toji.id }) })
  // Anything before the mute was rightly delivered; only what follows counts.
  await adminFetch(`/rest/v1/notifications?user_id=eq.${me.id}`, { method: 'DELETE' })

  await login(page, me.email)
  await page.goto('/')
  await expect(page.locator('article[data-review-id]').first()).toBeVisible()
  await expect(page.locator(`article[data-review-id="${review}"]`)).toHaveCount(0)

  // Their comment folds; Show and Hide again.
  await page.goto(`/song/${songs[2].id}?review=${mine}`)
  const card = page.locator(`article[data-review-id="${mine}"]`)
  await card.getByRole('button', { name: /comments?$/i }).first().click()
  const scope = (await page.getByRole('dialog').count()) > 0 ? page.getByRole('dialog') : card
  await expect(scope.getByText('Comment from someone you muted')).toBeVisible()
  await expect(scope.getByText('honestly mid')).toHaveCount(0)
  await expect(scope.getByText('the bridge on this one')).toBeVisible()
  await scope.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(scope.getByText('honestly mid')).toBeVisible()
  await scope.getByRole('button', { name: 'Hide again' }).click()
  await expect(scope.getByText('honestly mid')).toHaveCount(0)

  // Still on their own profile.
  await page.goto(`/profile/${toji.id}`)
  await expect(page.getByText(`You muted @${toji.username}.`)).toBeVisible()
  await expect(page.locator(`article[data-review-id="${review}"]`)).toBeVisible()

  // No notification from them, and the follow-free mute changed nothing for them.
  await commentAs(toji.token, mine, toji.id, `@${me.username} did you see this`)
  expect((await notificationsOf(me.id)).filter((n) => n.payload.actor_id === toji.id)).toHaveLength(0)
})

test('Settings → Muted accounts: the list, Unmute and Mute again, and the empty state', async ({ page }) => {
  await login(page, me.email)
  await page.goto('/settings')
  await page.getByRole('link', { name: /Muted accounts/ }).click()
  await page.waitForURL(/\/settings\/muted/)
  const list = page.getByRole('list', { name: 'Muted accounts' })
  await expect(list).toContainText(`@${toji.username}`)
  await expect(list).toContainText('muted just now')

  await list.getByRole('button', { name: 'Unmute Toji' }).click()
  await expect(list.getByRole('button', { name: 'Mute Toji' })).toBeVisible()
  await expect.poll(async () => ((await readAs(me.token, 'user_mutes?select=muted_id')).rows as unknown[]).length).toBe(0)

  await page.reload()
  await expect(page.getByText("You haven't muted anyone")).toBeVisible()
})
