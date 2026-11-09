import { test, expect, type Page } from './fixtures'
import {
  adminFetch,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  env,
  likeReviewAs,
  login,
  makeFollow,
  setPrivate,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * Song likes follow the liker's privacy (migration 0057): readable by the
 * owner and by whoever may see the owner's profile, and by nobody signed out.
 * Checked straight against the database as well as through the pages, since
 * the page hiding a tab was all that protected them before.
 */
test.describe.configure({ mode: 'serial' })

let publicUser: { id: string; email: string }
let privateUser: { id: string; email: string }
let stranger: { id: string; email: string }
let follower: { id: string; email: string }
let songs: PlayableSong[]

test.beforeAll(async ({}, info) => {
  const p = info.project.name
  publicUser = await createTestUser(`lp-public-${p}`)
  privateUser = await createTestUser(`lp-private-${p}`)
  stranger = await createTestUser(`lp-stranger-${p}`)
  follower = await createTestUser(`lp-follower-${p}`)
  songs = await distinctSongs(4)
  await setPrivate(privateUser.id, true)
  await makeFollow(follower.id, privateUser.id)
  const likes = [
    { user_id: publicUser.id, song_id: songs[0].id },
    { user_id: privateUser.id, song_id: songs[1].id },
    { user_id: stranger.id, song_id: songs[2].id },
  ]
  const res = await adminFetch('/rest/v1/song_likes', { method: 'POST', body: JSON.stringify(likes) })
  expect(res.ok).toBe(true)
})

test.afterAll(async () => {
  for (const u of [publicUser, privateUser, stranger, follower]) await deleteTestUsers(u.email)
})

/** The song ids a viewer gets when reading someone's likes straight from the table. */
async function likesAs(ownerId: string, viewerEmail: string | null) {
  const res = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/song_likes?user_id=eq.${ownerId}&select=song_id`,
    {
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${viewerEmail ? await tokenFor(viewerEmail) : env.VITE_SUPABASE_ANON_KEY}`,
      },
    }
  )
  expect(res.ok).toBe(true)
  return ((await res.json()) as { song_id: string }[]).map((r) => r.song_id)
}

test.describe('the database', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'Same rule on both layouts; checked once')
  })

  test('a public account: readable when signed in, not when signed out', async () => {
    expect(await likesAs(publicUser.id, stranger.email)).toEqual([songs[0].id])
    expect(await likesAs(publicUser.id, null)).toEqual([])
  })

  test('a private account: its owner and accepted followers only', async () => {
    expect(await likesAs(privateUser.id, privateUser.email)).toEqual([songs[1].id])
    expect(await likesAs(privateUser.id, follower.email)).toEqual([songs[1].id])
    expect(await likesAs(privateUser.id, stranger.email)).toEqual([])
    expect(await likesAs(privateUser.id, null)).toEqual([])
  })

  test('a pending follow request does not open them', async () => {
    const pending = await createTestUser('lp-pending')
    try {
      await makeFollow(pending.id, privateUser.id, 'pending')
      expect(await likesAs(privateUser.id, pending.email)).toEqual([])
    } finally {
      await deleteTestUsers(pending.email)
    }
  })

  test('suggested songs still leave out your own likes', async () => {
    const token = await tokenFor(stranger.email)
    const [{ artist_id }] = (await (
      await adminFetch(`/rest/v1/songs?id=eq.${songs[2].id}&select=artist_id`)
    ).json()) as { artist_id: string }[]
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/suggested_songs`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_artist_ids: [artist_id], p_tags: [], p_limit: 20 }),
    })
    expect(res.ok, await res.clone().text()).toBe(true)
    const ids = ((await res.json()) as { id: string }[]).map((r) => r.id)
    expect(ids).not.toContain(songs[2].id)
  })
})

const unlike = (page: Page, title: string) => page.getByRole('button', { name: `Unlike ${title}`, exact: true })
const play = (page: Page, title: string) => page.getByRole('button', { name: `Play ${title}`, exact: true })

test.describe('the app', () => {
  test("a public profile's Likes tab, seen by someone else", async ({ page }) => {
    await login(page, stranger.email)
    await page.goto(`/profile/${publicUser.id}?tab=likes`)
    await expect(play(page, songs[0].title)).toBeVisible()
  })

  test('a private profile, seen by a stranger: the lock card, and no likes', async ({ page }) => {
    await login(page, stranger.email)
    await page.goto(`/profile/${privateUser.id}?tab=likes`)
    await expect(page.getByText('This account is private. Follow to see their reviews, playlists and stats.')).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(play(page, songs[1].title)).toHaveCount(0)
  })

  test('a private profile, seen by an accepted follower: its likes', async ({ page }) => {
    await login(page, follower.email)
    await page.goto(`/profile/${privateUser.id}?tab=likes`)
    await expect(play(page, songs[1].title)).toBeVisible()
  })

  test('your own private profile: your likes, with unlike', async ({ page }) => {
    await login(page, privateUser.email)
    await page.goto(`/profile/${privateUser.id}?tab=likes`)
    await expect(unlike(page, songs[1].title)).toBeVisible()
  })

  test('a song page: the like button saves and comes back, and a private liker still counts on a review', async ({
    page,
  }, info) => {
    const reviewAuthor = await createTestUser(`lp-author-${info.project.name}`)
    try {
      const reviewId = await createReview(
        reviewAuthor.id,
        songs[3].id,
        4,
        'A slow start, then the last chorus makes the whole wait worth it.'
      )
      const liked = await likeReviewAs(await tokenFor(privateUser.email), reviewId, privateUser.id)
      expect(liked.ok).toBe(true)

      await login(page, stranger.email)
      await page.goto(`/song/${songs[3].id}`)
      const card = page.locator(`article[data-review-id="${reviewId}"]`)
      await expect(card.getByRole('button', { name: /like/i }).first()).toContainText('1')

      await page.getByRole('button', { name: 'Add to liked songs' }).click()
      await expect(page.getByRole('button', { name: 'Remove from liked songs' })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', { name: 'Remove from liked songs' })).toBeVisible()
      await page.getByRole('button', { name: 'Remove from liked songs' }).click()
      await expect(page.getByRole('button', { name: 'Add to liked songs' })).toBeVisible()
    } finally {
      await deleteTestUsers(reviewAuthor.email)
    }
  })
})
