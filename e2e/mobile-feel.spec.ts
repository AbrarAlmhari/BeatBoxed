import { test, expect, type Page } from '@playwright/test'
import { createTestUser, deleteTestUsers, env, login, tokenFor } from './helpers'

/**
 * Phone feel: no zoom when typing, Home's sticky tabs, scroll to top, and
 * the song of the week (fold, unfold, the timer) on Sunday-to-Saturday
 * Saudi weeks.
 *
 * The song of the week's data is stubbed where a test needs a particular
 * moment of the week. The clock is faked only backwards from the real time:
 * a sign-in token stays valid in the past, but looks expired in the future.
 */

const DAY = 86_400_000
const HOUR = 3_600_000
const CIRCUMFERENCE = 2 * Math.PI * 5

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`feel-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

/** The most recent Saudi midnight at least an hour ago: a week end in the past. */
function pastWeekEnd() {
  const riyadhMidnight = (ms: number) => Math.floor((ms + 3 * HOUR) / DAY) * DAY - 3 * HOUR
  let end = riyadhMidnight(Date.now())
  if (Date.now() - end < HOUR) end -= DAY
  return end
}

/** weekly_song_page's answer for a week ending at `endsAt`. */
function weekPage(endsAt: number, { myRating = null as number | null } = {}) {
  const day = (ms: number) => new Date(ms + 3 * HOUR).toISOString().slice(0, 10)
  return {
    week_start: day(endsAt - 7 * DAY),
    week_end: day(endsAt - DAY),
    starts_at: new Date(endsAt - 7 * DAY).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    reason: 'trending',
    song: { id: '00000000-0000-0000-0000-00000000c0de', title: 'Stub Song', artist_id: null, artist_name: 'Stub Artist', cover_url: null, album_id: null },
    my_rating: myRating,
    average: 4.4,
    ratings: 5,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 2 },
    followed_raters: [],
    followed_rater_count: 0,
    top_reviews: [],
    matches_taste: false,
    past_weeks: [],
  }
}

/**
 * Answers requests for the week with the first of `pages` until next() is
 * called (the app may ask more than once while loading).
 */
async function stubWeek(page: Page, ...pages: (object | null)[]) {
  let i = 0
  await page.route('**/rest/v1/rpc/weekly_song_page**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pages[i]) })
  )
  return {
    next() {
      i = Math.min(i + 1, pages.length - 1)
    },
  }
}

const full = (page: Page) => page.getByRole('region', { name: 'Song of the week' })
const mini = (page: Page) => page.getByRole('button', { name: /^Song of the week, / })
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

async function scrollDown(page: Page, by = 1800) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), by)
  await expect.poll(() => scrollY(page)).toBeGreaterThan(by / 2)
}

/** Clears the remembered fold, so each test starts unfolded. */
async function freshHome(page: Page, path = '/') {
  await login(page, user.email)
  await page.evaluate((id) => localStorage.removeItem(`beatboxed:sotw-folded:${id}`), user.id)
  await page.goto(path)
}

async function feedLoaded(page: Page) {
  await expect(page.locator('[data-feed-index="3"]')).toBeAttached()
}

test.describe('typing on a phone', () => {
  test('text boxes are 16px on phone screens, and pinch-zoom stays allowed', async ({ page }, info) => {
    await page.goto('/login')
    const size = await page.getByRole('textbox', { name: 'Email' }).evaluate((el) => getComputedStyle(el).fontSize)
    expect(size).toBe(info.project.name === 'mobile' ? '16px' : '15px')

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/)

    if (info.project.name !== 'mobile') return
    // Inside the app too: the composer and search.
    await login(page, user.email)
    await page.goto('/explore')
    const search = page.getByRole('searchbox').or(page.getByRole('textbox')).first()
    await expect(search).toBeVisible()
    expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
  })
})

test.describe('Home tabs', () => {
  test('the tab row stays visible, on a solid background, while the feed scrolls', async ({ page }) => {
    await freshHome(page)
    await feedLoaded(page)
    await scrollDown(page)
    const tabs = page.getByRole('tablist', { name: 'Feed' })
    await expect(tabs).toBeInViewport()
    const box = await tabs.boundingBox()
    expect(box!.y).toBeLessThan(140)
    const bg = await page.locator('[data-feed-tabs]').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(13, 13, 18)')
  })

  test('tapping the tab you are on goes back to the top', async ({ page }) => {
    await freshHome(page)
    await feedLoaded(page)
    await scrollDown(page)
    await page.getByRole('tab', { name: 'For You' }).click()
    await expect.poll(() => scrollY(page)).toBe(0)
  })

  test('switching tabs opens the other tab at the very top', async ({ page }) => {
    await freshHome(page)
    await feedLoaded(page)
    await scrollDown(page)
    await page.getByRole('tab', { name: 'Following' }).click()
    await expect(page).toHaveURL(/tab=following/)
    await expect.poll(() => scrollY(page)).toBe(0)
    // Scrolling that far folded the song of the week; it stays folded here.
    await expect(mini(page)).toBeInViewport()
  })

  test('tapping Home while on Home goes back to the top, on the same tab', async ({ page }) => {
    await freshHome(page, '/?tab=following')
    await expect(page.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'true')
    await page.evaluate(() => document.body.style.setProperty('min-height', '400vh'))
    await scrollDown(page)
    await page.locator('[data-tour="nav-home"]:visible').click()
    await expect.poll(() => scrollY(page)).toBe(0)
    await expect(page).toHaveURL(/tab=following/)
  })
})

test.describe('song of the week', () => {
  test('folds after the 3rd review without moving what you are reading', async ({ page }) => {
    await freshHome(page)
    await feedLoaded(page)
    await expect(full(page)).toBeVisible()

    // Get the tab row stuck first (it sits a little higher stuck than in
    // place), then scroll so the 3rd review has just gone under it.
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }))
    await expect(full(page)).toBeVisible()
    const expectedTop = await page.evaluate(() => {
      const third = document.querySelector<HTMLElement>('[data-feed-index="2"]')!
      const fourth = document.querySelector<HTMLElement>('[data-feed-index="3"]')!
      const rowBottom = document.querySelector<HTMLElement>('[data-feed-tabs]')!.getBoundingClientRect().bottom
      const by = third.getBoundingClientRect().bottom - rowBottom + 8
      const fourthTop = fourth.getBoundingClientRect().top - by
      window.scrollBy({ top: by, behavior: 'instant' })
      return fourthTop
    })
    await expect(mini(page)).toBeVisible()
    await expect(full(page)).toHaveCount(0)
    const top = await page.locator('[data-feed-index="3"]').evaluate((el) => el.getBoundingClientRect().top)
    expect(Math.abs(top - expectedTop)).toBeLessThan(3)
  })

  test('the arrow folds it; it stays folded on both tabs and after a reload; the small record opens it at the top', async ({
    page,
  }) => {
    await freshHome(page)
    await page.getByRole('button', { name: 'Fold song of the week into the top bar' }).click()
    await expect(mini(page)).toBeVisible()
    await expect(full(page)).toHaveCount(0)

    await page.getByRole('tab', { name: 'Following' }).click()
    await expect(mini(page)).toBeVisible()
    await expect(full(page)).toHaveCount(0)

    await page.reload()
    await expect(mini(page)).toBeVisible()
    await expect(full(page)).toHaveCount(0)

    await page.evaluate(() => document.body.style.setProperty('min-height', '400vh'))
    await scrollDown(page)
    await mini(page).click()
    await expect(full(page)).toBeVisible()
    await expect.poll(() => scrollY(page)).toBe(0)
    await expect(mini(page)).toHaveCount(0)
  })

  test('already rated: starts folded', async ({ page }) => {
    await stubWeek(page, weekPage(pastWeekEnd() + 4 * DAY, { myRating: 4 }))
    await freshHome(page)
    await expect(mini(page)).toBeVisible()
    await expect(full(page)).toHaveCount(0)
  })

  test('no song this week: nothing at all', async ({ page }) => {
    await stubWeek(page, null)
    await freshHome(page)
    await expect(page.getByRole('tab', { name: 'For You' })).toBeVisible()
    await expect(full(page)).toHaveCount(0)
    await expect(mini(page)).toHaveCount(0)
  })
})

test.describe('the week timer', () => {
  type Moment = { name: string; before: number; label: string; share: number; spinning: boolean; hue: number }
  const moments: Moment[] = [
    { name: '7 days', before: 7 * DAY - 60_000, label: '7 days left', share: 1, spinning: false, hue: 130 },
    { name: '3 days', before: 3 * DAY - HOUR, label: '3 days left', share: (3 * DAY - HOUR) / (7 * DAY), spinning: false, hue: 55 },
    { name: 'the last day', before: 10 * HOUR, label: 'last day', share: (10 * HOUR) / (7 * DAY), spinning: true, hue: 8 },
    { name: 'the last hour', before: 30 * 60_000, label: 'less than an hour left', share: 0.03, spinning: true, hue: 0 },
  ]

  for (const m of moments) {
    test(`at ${m.name} left: size, colour, words and spin`, async ({ page }) => {
      const end = pastWeekEnd()
      await page.clock.install({ time: end - m.before })
      await stubWeek(page, weekPage(end))
      await freshHome(page)

      await expect(full(page).locator('[data-week-left]')).toHaveText(m.label)
      const pie = full(page).locator('[data-timer-pie]')
      const drawn = parseFloat((await pie.getAttribute('stroke-dasharray'))!.split(' ')[0])
      expect(drawn / CIRCUMFERENCE).toBeCloseTo(m.share, 2)
      expect(await pie.getAttribute('stroke')).toMatch(new RegExp(`^hsl\\(${m.hue} `))
      const record = full(page).locator('[data-spinning]')
      await expect(record).toHaveAttribute('data-spinning', String(m.spinning))
      const animation = await record.evaluate((el) => getComputedStyle(el).animationName)
      expect(animation).toBe(m.spinning ? 'spin' : 'none')

      // The small record says the same to a screen reader.
      await page.getByRole('button', { name: 'Fold song of the week into the top bar' }).click()
      await expect(page.getByRole('button', { name: `Song of the week, ${m.label}` })).toBeVisible()
    })
  }

  test('no spinning with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const end = pastWeekEnd()
    await page.clock.install({ time: end - 2 * HOUR })
    await stubWeek(page, weekPage(end))
    await freshHome(page)
    const record = full(page).locator('[data-spinning]')
    await expect(record).toHaveAttribute('data-spinning', 'true')
    expect(await record.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  })

  test('updates every minute', async ({ page }) => {
    const end = pastWeekEnd()
    await page.clock.install({ time: end - 6 * HOUR - 30_000 })
    await stubWeek(page, weekPage(end))
    await freshHome(page)
    await expect(full(page).locator('[data-week-left]')).toHaveText('last day')
    await page.clock.runFor(61_000)
    await expect(full(page).locator('[data-week-left]')).toHaveText('6 hours left')
  })

  test('Saturday 23:59 is the old week; at Sunday 00:00 the next week arrives', async ({ page }) => {
    const end = pastWeekEnd()
    await page.clock.install({ time: end - 30_000 })
    const week = await stubWeek(page, weekPage(end), weekPage(end + 7 * DAY))
    await freshHome(page)
    await expect(full(page).locator('[data-week-left]')).toHaveText('less than an hour left')
    week.next()
    await page.clock.runFor(61_000)
    await expect(full(page).locator('[data-week-left]')).toHaveText('7 days left')
    await expect(full(page).locator('[data-spinning]')).toHaveAttribute('data-spinning', 'false')
  })
})

test.describe('the database week', () => {
  test('Saturday 23:59 and Sunday 00:00 Saudi time fall in different weeks', async ({}, info) => {
    test.skip(info.project.name !== 'desktop', 'one database check is enough')
    const token = await tokenFor(user.email)
    const bounds = async (at: string) => {
      const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/riyadh_week_bounds`, {
        method: 'POST',
        headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_at: at }),
      })
      expect(res.status).toBe(200)
      return (await res.json())[0]
    }
    const saturday = await bounds('2026-10-31T23:59:00+03:00')
    const sunday = await bounds('2026-11-01T00:00:00+03:00')
    expect(saturday).toMatchObject({ week_start: '2026-10-25', week_end: '2026-10-31' })
    expect(Date.parse(saturday.ends_at)).toBe(Date.parse('2026-11-01T00:00:00+03:00'))
    expect(sunday).toMatchObject({ week_start: '2026-11-01', week_end: '2026-11-07' })
    expect(Date.parse(sunday.starts_at)).toBe(Date.parse('2026-11-01T00:00:00+03:00'))
  })
})
