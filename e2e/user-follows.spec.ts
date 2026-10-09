import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  env,
  followRow,
  login,
  logout,
  makeFollow,
  notificationsOf,
  setPrivate,
  settingsOf,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * One-way follows (0027). Public accounts are followed instantly; private
 * accounts get a request the owner accepts or declines, and only accepted
 * followers see a private account's reviews and playlists.
 *
 * Every rule is checked in the database as well as on screen: visibility is
 * enforced by RLS through can_view_profile(), and a test that only looked at
 * the page couldn't tell enforcement from hiding.
 */

type User = { id: string; email: string }

/** Clears every follow between suite accounts, so each test sets its own. */
async function clearFollows(users: User[]) {
  for (const u of users) {
    await adminFetch(`/rest/v1/user_follows?follower_id=eq.${u.id}`, { method: 'DELETE' })
    await adminFetch(`/rest/v1/notifications?user_id=eq.${u.id}`, { method: 'DELETE' })
  }
}

const profileButton = (page: Page, name: string) =>
  page.locator('header').getByRole('button', { name, exact: true })

const LOCKED = 'This account is private. Follow them to request access to their reviews and playlists.'

test.describe('user follows', () => {
  let pub: User
  let priv: User
  let fan: User
  let other: User
  let songs: PlayableSong[]
  const pubReview = 'A public take on this one, out in the open.'
  const privReview = 'A private take, only for approved followers.'

  test.beforeAll(async () => {
    pub = await createTestUser('uf-public')
    priv = await createTestUser('uf-private')
    fan = await createTestUser('uf-fan')
    other = await createTestUser('uf-other')
    songs = await distinctSongs(2)
    await createReview(pub.id, songs[0].id, 4, pubReview)
    await createReview(priv.id, songs[1].id, 5, privReview)
  })

  test.beforeEach(async () => {
    await clearFollows([pub, priv, fan, other])
    await setPrivate(pub.id, false)
    await setPrivate(priv.id, true)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test('following a public account is instant, and their reviews are visible', async ({
    page,
  }) => {
    await login(page, fan.email)
    await page.goto(`/profile/${pub.id}`)
    await profileButton(page, 'Follow').click()

    // No request step: straight to Following, in the database too.
    await expect(profileButton(page, 'Following')).toBeVisible()
    await expect.poll(() => followRow(fan.id, pub.id)).toBe('accepted')
    await expect(page.getByText(pubReview)).toBeVisible()

    // The follower count moved, and the owner was told.
    await page.reload()
    await expect(page.getByRole('link', { name: /Followers\s*1/ })).toBeVisible()
    await expect
      .poll(async () =>
        (await notificationsOf(pub.id)).some(
          (n) => n.type === 'new_follower' && n.payload.actor_id === fan.id
        )
      )
      .toBe(true)
  })

  test('following a private account sends a request; accepting it reveals their content', async ({
    page,
  }) => {
    await login(page, fan.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByText(LOCKED)).toBeVisible()

    await profileButton(page, 'Follow').click()
    await expect(
      page.getByRole('button', { name: 'Requested, tap to cancel the request' })
    ).toBeVisible()
    await expect.poll(() => followRow(fan.id, priv.id)).toBe('pending')

    // Still locked while pending: on the profile and on the song page.
    await page.reload()
    await expect(page.getByText(LOCKED)).toBeVisible()
    await page.goto(`/song/${songs[1].id}`)
    await expect(page.getByText(privReview)).toHaveCount(0)

    // The owner sees it under Follow requests and accepts.
    await logout(page)
    await login(page, priv.email)
    await page.goto('/notifications')
    await page.getByRole('link', { name: /Follow requests/ }).click()
    await page.waitForURL(/\/notifications\/requests/)
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect.poll(() => followRow(fan.id, priv.id)).toBe('accepted')
    await expect
      .poll(async () =>
        (await notificationsOf(fan.id)).some(
          (n) => n.type === 'follow_accepted' && n.payload.actor_id === priv.id
        )
      )
      .toBe(true)

    // Now the follower sees everything.
    await logout(page)
    await login(page, fan.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByText(LOCKED)).toHaveCount(0)
    await expect(page.getByText(privReview)).toBeVisible()
    await page.goto(`/song/${songs[1].id}`)
    await expect(page.getByText(privReview)).toBeVisible()
  })

  test('declining a request keeps the account hidden', async ({ page }) => {
    await makeFollow(other.id, priv.id, 'pending')

    await login(page, priv.email)
    await page.goto('/notifications/requests')
    await page.getByRole('button', { name: 'Decline' }).click()
    await expect.poll(() => followRow(other.id, priv.id)).toBe(null)
    await expect(page.getByText('No pending requests.')).toBeVisible()

    await logout(page)
    await login(page, other.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByText(LOCKED)).toBeVisible()
    await expect(profileButton(page, 'Follow')).toBeVisible()
    await page.goto(`/song/${songs[1].id}`)
    await expect(page.getByText(privReview)).toHaveCount(0)
  })

  test('unfollow asks first, then removes the follow', async ({ page }) => {
    await makeFollow(fan.id, pub.id)

    await login(page, fan.email)
    await page.goto(`/profile/${pub.id}`)
    await profileButton(page, 'Following').click()
    // Nothing happens until the confirm.
    await expect.poll(() => followRow(fan.id, pub.id)).toBe('accepted')
    await profileButton(page, 'Unfollow').click()

    await expect(profileButton(page, 'Follow')).toBeVisible()
    await expect.poll(() => followRow(fan.id, pub.id)).toBe(null)
  })

  test('removing a follower revokes their access to a private account', async ({ page }) => {
    await makeFollow(fan.id, priv.id, 'accepted')

    await login(page, priv.email)
    await page.goto(`/profile/${priv.id}/followers`)
    await expect(page.locator(`a[href="/profile/${fan.id}"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('button', { name: 'Remove follower' }).click()
    await expect.poll(() => followRow(fan.id, priv.id)).toBe(null)
    await expect(page.getByText('No followers yet')).toBeVisible()

    await logout(page)
    await login(page, fan.email)
    await page.goto(`/profile/${priv.id}`)
    await expect(page.getByText(LOCKED)).toBeVisible()
  })

  test('switching private to public accepts every pending request', async () => {
    await makeFollow(fan.id, priv.id, 'pending')
    await makeFollow(other.id, priv.id, 'pending')

    await setPrivate(priv.id, false)

    await expect.poll(() => followRow(fan.id, priv.id)).toBe('accepted')
    await expect.poll(() => followRow(other.id, priv.id)).toBe('accepted')
    // Each acceptance tells the person who asked.
    for (const u of [fan, other]) {
      await expect
        .poll(async () =>
          (await notificationsOf(u.id)).some((n) => n.type === 'follow_accepted')
        )
        .toBe(true)
    }
  })

  test('a private account cannot be followed straight to accepted, whatever the client sends', async () => {
    // Insert as the fan through the normal API, asking for 'accepted'.
    const token = await tokenFor(fan.email)
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/user_follows`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ follower_id: fan.id, following_id: priv.id, status: 'accepted' }),
    })
    expect(res.status).toBeLessThan(400)
    expect(await followRow(fan.id, priv.id)).toBe('pending')

    // And the follower can't accept their own request.
    const patch = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/user_follows?follower_id=eq.${fan.id}&following_id=eq.${priv.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      }
    )
    expect(patch.status).toBeLessThan(500)
    expect(await followRow(fan.id, priv.id)).toBe('pending')
  })
})

/* ------------------------------------------------- private -> public warning */

test.describe('make account public warning', () => {
  let owner: User
  let requesters: User[]
  let song: PlayableSong
  const review = 'Only my approved followers should be reading this one.'

  test.beforeAll(async () => {
    owner = await createTestUser('mp-owner')
    requesters = []
    for (let i = 1; i <= 4; i++) requesters.push(await createTestUser(`mp-req${i}`))
    ;[song] = await distinctSongs(1)
    await createReview(owner.id, song.id, 4, review)
  })

  test.beforeEach(async () => {
    await clearFollows([owner, ...requesters])
    await setPrivate(owner.id, true)
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  async function requestAll() {
    for (const r of requesters) await makeFollow(r.id, owner.id, 'pending')
  }

  async function openWarning(page: Page) {
    await login(page, owner.email)
    await page.goto('/settings')
    await page.getByRole('switch', { name: 'Private account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make your account public?' })
    await expect(dialog).toBeVisible()
    return dialog
  }

  async function pendingStatuses() {
    return Promise.all(requesters.map((r) => followRow(r.id, owner.id)))
  }

  test('with pending requests, the warning shows the right count and who is waiting', async ({
    page,
  }) => {
    await requestAll()
    const dialog = await openWarning(page)

    await expect(dialog.getByTestId('make-public-text')).toHaveText(
      'You have 4 pending follow requests. Making your account public will accept all of them, and anyone will be able to see your reviews and playlists.'
    )
    // Three avatars, and the rest summarised.
    await expect(dialog.getByRole('list', { name: 'People waiting' }).getByRole('listitem')).toHaveCount(3)
    await expect(dialog.getByText('and 1 other')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Make public and accept all' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Review requests first' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('the count is read fresh when the warning opens', async ({ page }) => {
    // Settings loads with nobody waiting...
    await login(page, owner.email)
    await page.goto('/settings')
    await expect(page.getByRole('switch', { name: 'Private account' })).toBeVisible()

    // ...then a request arrives before the switch is touched.
    await makeFollow(requesters[0].id, owner.id, 'pending')
    await page.getByRole('switch', { name: 'Private account' }).click()
    await expect(page.getByTestId('make-public-text')).toContainText(
      'You have 1 pending follow request.'
    )
  })

  test('"Make public and accept all" makes the account public and lets requesters in', async ({
    page,
  }) => {
    await requestAll()
    const dialog = await openWarning(page)
    await dialog.getByRole('button', { name: 'Make public and accept all' }).click()

    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await settingsOf(owner.id)).profile.is_private).toBe(false)
    await expect(page.getByRole('switch', { name: 'Private account' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    // Accepted by the database trigger, not by the page.
    await expect.poll(pendingStatuses).toEqual(['accepted', 'accepted', 'accepted', 'accepted'])

    await logout(page)
    await login(page, requesters[0].email)
    await page.goto(`/profile/${owner.id}`)
    await expect(page.getByText(LOCKED)).toHaveCount(0)
    await expect(page.getByText(review)).toBeVisible()
    await expect(page.locator('header').getByRole('button', { name: 'Following', exact: true })).toBeVisible()
  })

  test('"Cancel" keeps the account private and the requests pending', async ({ page }) => {
    await requestAll()
    const dialog = await openWarning(page)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Private account' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // Escape is another way to cancel; it must do the same.
    await page.getByRole('switch', { name: 'Private account' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Give any stray write a moment, then confirm nothing changed.
    await page.waitForTimeout(1000)
    expect((await settingsOf(owner.id)).profile.is_private).toBe(true)
    expect(await pendingStatuses()).toEqual(['pending', 'pending', 'pending', 'pending'])
  })

  test('"Review requests first" opens the requests page and changes nothing', async ({
    page,
  }) => {
    await requestAll()
    const dialog = await openWarning(page)
    await dialog.getByRole('button', { name: 'Review requests first' }).click()

    await page.waitForURL(/\/notifications\/requests$/)
    await expect(page.getByRole('heading', { name: 'Follow requests' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(4)

    expect((await settingsOf(owner.id)).profile.is_private).toBe(true)
    expect(await pendingStatuses()).toEqual(['pending', 'pending', 'pending', 'pending'])
  })

  test('with no pending requests, the shorter confirmation shows', async ({ page }) => {
    const dialog = await openWarning(page)

    await expect(dialog.getByTestId('make-public-text')).toHaveText(
      'Anyone will be able to see your reviews and playlists.'
    )
    await expect(dialog.getByRole('button', { name: 'Review requests first' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Make public and accept all' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Make public', exact: true }).click()
    await expect.poll(async () => (await settingsOf(owner.id)).profile.is_private).toBe(false)
  })

  test('going public to private saves straight away, with no warning', async ({ page }) => {
    await setPrivate(owner.id, false)
    await login(page, owner.email)
    await page.goto('/settings')
    await page.getByRole('switch', { name: 'Private account' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await settingsOf(owner.id)).profile.is_private).toBe(true)
  })
})

/* ---------------------------------------------------------- the conversion */

/**
 * Checks 0027's one-off copy against the friendships table it was made from,
 * which is left in place for exactly this. Reads real (non-suite) data, so it
 * is meant to be run right after the migration, before anyone has had a
 * chance to unfollow.
 *
 *   accepted friendship         -> accepted follow, both directions
 *   pending, to a private user  -> pending follow
 *   pending, to a public user   -> accepted follow
 */
test('converted follows match the old friendships', async () => {
  const friendships = (await (
    await adminFetch('/rest/v1/friendships?select=user_id,friend_id,status')
  ).json()) as { user_id: string; friend_id: string; status: string }[]
  const follows = (await (
    await adminFetch('/rest/v1/user_follows?select=follower_id,following_id,status')
  ).json()) as { follower_id: string; following_id: string; status: string }[]
  const profiles = (await (
    await adminFetch('/rest/v1/profiles?select=id,is_private')
  ).json()) as { id: string; is_private: boolean }[]

  const privacy = new Map(profiles.map((p) => [p.id, p.is_private]))
  const status = new Map(follows.map((f) => [`${f.follower_id}>${f.following_id}`, f.status]))

  const problems: string[] = []
  for (const f of friendships) {
    if (f.status === 'accepted') {
      for (const key of [`${f.user_id}>${f.friend_id}`, `${f.friend_id}>${f.user_id}`]) {
        if (status.get(key) !== 'accepted') {
          problems.push(`${key}: expected accepted, got ${status.get(key) ?? 'missing'}`)
        }
      }
    } else {
      const key = `${f.user_id}>${f.friend_id}`
      const expected = privacy.get(f.friend_id) ? 'pending' : 'accepted'
      if (status.get(key) !== expected) {
        problems.push(`${key}: expected ${expected}, got ${status.get(key) ?? 'missing'}`)
      }
    }
  }

  expect(friendships.length).toBeGreaterThan(0)
  expect(problems).toEqual([])
})
