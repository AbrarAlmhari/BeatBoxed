import { test, expect, type Page } from '@playwright/test'
import {
  adminFetch,
  createTestUser,
  deleteTestUsers,
  followArtistAs,
  login,
  makeFollow,
  nameUser,
  setPrivate,
} from './helpers'

/**
 * The profile layout: gear and ⋯, "followers · following", "Listens to",
 * the review counts, and the three lists (Followers, Following, Artists):
 * they scroll, load more, open what you tap, and their follow buttons work
 * and move the counts.
 */

type U = { id: string; email: string }
let me: U
let other: U
let hidden: U
let empty: U
let fans: U[] = []
let followed: U[] = []
let artists: { id: string; name: string }[] = []
const FOLLOWED = 32

test.describe.configure({ timeout: 120_000 })

test.beforeAll(async ({}, info) => {
  test.setTimeout(600_000)
  const p = info.project.name
  me = await createTestUser(`pl-me-${p}`)
  other = await createTestUser(`pl-other-${p}`)
  hidden = await createTestUser(`pl-hidden-${p}`)
  empty = await createTestUser(`pl-empty-${p}`)
  await nameUser(me.id, `plme${p}`.slice(0, 20), 'Layout Me')
  await nameUser(other.id, `plother${p}`.slice(0, 20), 'Layout Other')
  await nameUser(hidden.id, `plhidden${p}`.slice(0, 20), 'Layout Hidden')
  await adminFetch(`/rest/v1/profiles?id=eq.${me.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ bio: 'I love rap', favorite_genres: ['Rock', 'Hip-Hop'] }),
  })
  await setPrivate(hidden.id, true)

  // 32 people I follow (more than one page), 2 who follow me.
  followed = []
  for (let i = 0; i < FOLLOWED; i++) {
    const u = await createTestUser(`pl-f${i}-${p}`)
    await nameUser(u.id, `plf${i}${p}`.slice(0, 20), `Followed ${String(i).padStart(2, '0')}`)
    followed.push(u)
  }
  for (const u of followed) await makeFollow(me.id, u.id)
  fans = [await createTestUser(`pl-fan0-${p}`), await createTestUser(`pl-fan1-${p}`)]
  for (const [i, u] of fans.entries()) {
    await nameUser(u.id, `plfan${i}${p}`.slice(0, 20), `Fan ${i}`)
    await makeFollow(u.id, me.id)
  }
  // Six artists, and Other follows me too.
  artists = (await (await adminFetch('/rest/v1/artists?select=id,name&image_url=not.is.null&order=name&limit=6')).json()) as {
    id: string
    name: string
  }[]
  for (const a of artists) await followArtistAs(me.id, a.id)
  await followArtistAs(other.id, artists[0].id)
})

test.afterAll(async () => {
  test.setTimeout(600_000)
  for (const u of [...followed, ...fans, me, other, hidden, empty]) await deleteTestUsers(u.email)
})

const countButton = (page: Page, label: RegExp) => page.getByRole('list', { name: 'Profile counts' }).getByRole('button', { name: label })
const count = async (page: Page, label: RegExp) => Number((await countButton(page, label).innerText()).match(/\d+/)![0])
const list = (page: Page, name: string) => page.getByRole('dialog').getByRole('list', { name })
const scroller = (page: Page) => page.getByRole('dialog').locator('[data-list-scroller]')

/** Scrolls the open list the way a person would: a finger on phones, the wheel on computers. */
async function scrollList(page: Page, isPhone: boolean) {
  const box = (await scroller(page).boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  if (isPhone) {
    const cdp = await page.context().newCDPSession(page)
    const y0 = Math.round(box.y + box.height * 0.8)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 35 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.mouse.move(x, box.y + box.height / 2)
    await page.mouse.wheel(0, 900)
  }
}

async function ownProfile(page: Page) {
  await login(page, me.email)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Layout Me', level: 1 })).toBeVisible()
}

test.describe('header', () => {
  test('your own: gear opens Settings; counts line, Listens to, review counts', async ({ page }) => {
    await ownProfile(page)
    const counts = page.getByRole('list', { name: 'Profile counts' })
    await expect(counts).toContainText('2 followers')
    await expect(counts).toContainText(`${FOLLOWED} following`)
    // The old counts are gone from the header.
    await expect(counts.getByText(/ratings?|reviews?|artists?/)).toHaveCount(0)
    const listens = page.locator('[data-listens-to]')
    await expect(listens).toContainText(`Listens to ${artists[0].name}, ${artists[1].name} and 4 more`)
    await expect(listens.locator('img')).toHaveCount(4)
    await expect(page.getByRole('tab', { name: /^Reviews\s*0$/ })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^All\s*0$/ })).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).locator('visible=true').click()
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('⋯ on your own profile: Share profile and Copy profile link', async ({ page }) => {
    await ownProfile(page)
    await page.getByRole('button', { name: 'More options' }).locator('visible=true').click()
    const menu = page.getByRole('dialog', { name: 'Profile options' })
    await expect(menu.getByRole('button', { name: 'Share profile' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Copy profile link' })).toBeVisible()
    await expect(menu.getByRole('button', { name: /Mute|Report/ })).toHaveCount(0)
  })

  test("someone else's: no gear; Follow next to ⋯ with Share, Mute and Report", async ({ page }) => {
    await login(page, me.email)
    await page.goto(`/profile/${other.id}`)
    await expect(page.getByRole('heading', { name: 'Layout Other', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0)
    const follow = page.getByRole('button', { name: 'Follow', exact: true }).locator('visible=true')
    const more = page.getByRole('button', { name: 'More options' }).locator('visible=true')
    const f = (await follow.boundingBox())!
    const m = (await more.boundingBox())!
    expect(Math.abs(f.height - m.height)).toBeLessThan(2)
    expect(m.x - (f.x + f.width)).toBeLessThan(20)
    await expect(page.locator('[data-listens-to]')).toContainText(`Listens to ${artists[0].name}`)

    await more.click()
    const menu = page.getByRole('dialog', { name: 'Profile options' })
    await expect(menu.getByRole('button', { name: 'Share profile' })).toBeVisible()
    await expect(menu.getByRole('button', { name: /^Mute @/ })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Report' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Copy profile link' })).toHaveCount(0)
  })

  test('Report: pick a reason, send, see the thanks; a second report says it was already sent', async ({ page }) => {
    await login(page, me.email)
    await page.goto(`/profile/${other.id}`)
    const report = async () => {
      await page.getByRole('button', { name: 'More options' }).locator('visible=true').click()
      await page.getByRole('dialog', { name: 'Profile options' }).getByRole('button', { name: 'Report' }).click()
      const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Report / }) })
      await expect(sheet.getByRole('button', { name: 'Send report' })).toBeDisabled()
      await sheet.getByRole('radio', { name: 'Spam' }).check()
      await sheet.getByRole('textbox').fill('Posting the same link everywhere.')
      await sheet.getByRole('button', { name: 'Send report' }).click()
      await expect(sheet).toHaveCount(0)
    }
    await report()
    // Saved without reading it back (nobody can read reports from the app).
    await expect(page.getByRole('status').filter({ hasText: "Thanks, we'll take a look" })).toBeVisible()
    const rows = (await (await adminFetch(`/rest/v1/profile_reports?reporter_id=eq.${me.id}&reported_id=eq.${other.id}&select=reason,details,status`)).json()) as unknown[]
    expect(rows).toEqual([{ reason: 'spam', details: 'Posting the same link everywhere.', status: 'open' }])

    await report()
    await expect(page.getByRole('status').filter({ hasText: "You've already reported this profile." })).toBeVisible()
  })

  test('no artists: no Listens to row', async ({ page }) => {
    await login(page, me.email)
    await page.goto(`/profile/${empty.id}`)
    await expect(page.getByRole('list', { name: 'Profile counts' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-listens-to]')).toHaveCount(0)
  })
})

test.describe('lists', () => {
  test('Following: opens on its own, scrolls, loads more, unfollow moves the count, a row opens the profile', async ({
    page,
  }, info) => {
    await ownProfile(page)
    await countButton(page, /following/).click()
    const rows = list(page, 'Following').getByRole('listitem')
    await expect(rows).toHaveCount(30)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Following' })).toBeVisible()

    // Scrolls, and the rest loads near the bottom.
    for (let i = 0; i < 4 && (await rows.count()) < FOLLOWED; i++) await scrollList(page, info.project.name === 'mobile')
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(rows).toHaveCount(FOLLOWED)

    // Unfollow the first one: the header's count goes down.
    await scroller(page).evaluate((el) => el.scrollTo({ top: 0 }))
    const first = rows.first()
    await first.getByRole('button', { name: 'Following' }).click()
    await first.getByRole('button', { name: 'Unfollow' }).click()
    await expect(first.getByRole('button', { name: 'Follow', exact: true })).toBeVisible()
    await expect.poll(() => count(page, /following/)).toBe(FOLLOWED - 1)
    // And follow again: back up.
    await first.getByRole('button', { name: 'Follow', exact: true }).click()
    await expect(first.getByRole('button', { name: 'Following' })).toBeVisible()
    await expect.poll(() => count(page, /following/)).toBe(FOLLOWED)

    // A row opens that profile and closes the list.
    const link = rows.nth(1).getByRole('link')
    const href = await link.getAttribute('href')
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Followers: Follow back moves the count; ⋯ removes a follower after a confirmation; your row has no button', async ({
    page,
  }) => {
    await ownProfile(page)
    await countButton(page, /followers?/).click()
    const rows = list(page, 'Followers').getByRole('listitem')
    await expect(rows).toHaveCount(2)
    const fan = rows.filter({ hasText: 'Fan 0' })
    await fan.getByRole('button', { name: 'Follow back' }).click()
    await expect(fan.getByRole('button', { name: 'Following' })).toBeVisible()
    await expect.poll(() => count(page, /following/)).toBe(FOLLOWED + 1)

    const second = rows.filter({ hasText: 'Fan 1' })
    await second.getByRole('button', { name: /More options for/ }).click()
    const menu = page.getByRole('dialog', { name: 'Follower options' })
    await menu.getByRole('button', { name: 'Remove follower' }).click()
    await expect(menu.getByText(/from your followers\? They won't be told\./)).toBeVisible()
    await menu.getByRole('button', { name: 'Remove' }).click()
    await expect(rows).toHaveCount(1)
    await expect.poll(() => count(page, /followers?/)).toBe(1)

    // Put things back for the other tests.
    await page.keyboard.press('Escape')
    await adminFetch(`/rest/v1/user_follows?follower_id=eq.${me.id}&following_id=eq.${fans[0].id}`, { method: 'DELETE' })
    await makeFollow(fans[1].id, me.id)

    // On someone else's followers list, your own row has no button.
    await page.goto(`/profile/${followed[0].id}`)
    await countButton(page, /followers?/).click()
    const mine = list(page, 'Followers').getByRole('listitem').filter({ hasText: 'Layout Me' })
    await expect(mine).toBeVisible()
    await expect(mine.getByRole('button')).toHaveCount(0)
  })

  test('Artists: opens from Listens to, unfollow moves the row and the count, a row opens the artist', async ({ page }) => {
    await ownProfile(page)
    await page.locator('[data-listens-to]').click()
    const rows = list(page, 'Artists').getByRole('listitem')
    await expect(rows).toHaveCount(artists.length)
    await expect(rows.first()).toContainText('Artist')
    // Artists only: every row is an artist.
    for (const row of await rows.all()) await expect(row).toContainText('Artist')

    const last = rows.last()
    await last.getByRole('button', { name: 'Unfollow this artist' }).click()
    await expect(last.getByRole('button', { name: 'Follow this artist' })).toBeVisible()
    await expect(page.locator('[data-listens-to]')).toContainText('and 3 more')
    await last.getByRole('button', { name: 'Follow this artist' }).click()
    await expect(page.locator('[data-listens-to]')).toContainText('and 4 more')

    const link = rows.first().getByRole('link')
    const href = await link.getAttribute('href')
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('following someone from their header moves their followers count', async ({ page }) => {
    await login(page, me.email)
    await page.goto(`/profile/${other.id}`)
    const before = await count(page, /followers?/)
    await page.getByRole('button', { name: 'Follow', exact: true }).locator('visible=true').click()
    await expect.poll(() => count(page, /followers?/)).toBe(before + 1)
    await page.getByRole('button', { name: 'Following', exact: true }).locator('visible=true').click()
    await page.getByRole('button', { name: 'Unfollow', exact: true }).locator('visible=true').click()
    await expect.poll(() => count(page, /followers?/)).toBe(before)
  })

  test("a private account you don't follow: counts show, every list says private", async ({ page }) => {
    await login(page, me.email)
    await page.goto(`/profile/${hidden.id}`)
    await expect(page.getByRole('list', { name: 'Profile counts' })).toBeVisible()
    for (const label of [/followers?/, /following/]) {
      await countButton(page, label).click()
      await expect(page.getByRole('dialog').getByText('This account is private')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  })
})
