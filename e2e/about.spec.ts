import { test, expect, type Page } from './fixtures'
import { adminFetch, createTestUser, deleteTestUsers, login } from './helpers'

/**
 * The About page: public, reached from Settings, the team in order, and
 * "Join BeatBoxed" only for visitors. Also the song page's lyrics, which
 * no longer carry a note about line highlighting.
 */

let user: { id: string; email: string }

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`about-${info.project.name}`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: /Music sounds better/ })
const join = (page: Page) => page.getByRole('link', { name: 'Join BeatBoxed' })
const teamCards = (page: Page) => page.locator('[data-team-card]')

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(width)
}

test('opens signed out, survives a refresh, and offers Join BeatBoxed', async ({ page }) => {
  await page.goto('/about')
  await expect(heading(page)).toBeVisible()
  await expect(page).toHaveTitle('About BeatBoxed')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /community where music lovers/)
  await expect(join(page)).toBeVisible()

  await page.reload()
  await expect(heading(page)).toBeVisible()
  await expect(page).toHaveURL(/\/about$/)
  await noSidewaysScroll(page)

  await join(page).click()
  await expect(page).toHaveURL(/\/signup$/)
})

test('opened directly while signed out, Back goes to Log in', async ({ page }) => {
  await page.goto('/about')
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('opens signed in, survives a refresh, and shows only Back', async ({ page }) => {
  await login(page, user.email)
  await page.goto('/about')
  await expect(heading(page)).toBeVisible()
  await page.reload()
  await expect(heading(page)).toBeVisible()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible()
  await expect(join(page)).toHaveCount(0)
})

test('Settings → About BeatBoxed opens it, and Back returns to Settings', async ({ page }) => {
  await login(page, user.email)
  await page.goto('/settings')
  await page.getByRole('link', { name: /About BeatBoxed/ }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(heading(page)).toBeVisible()
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

test('all seven team cards show, Abrar first as team lead', async ({ page }, info) => {
  await page.goto('/about')
  await expect(teamCards(page)).toHaveCount(7)
  const first = teamCards(page).first()
  await expect(first).toContainText('Abrar Saeed Almhari')
  await expect(first).toContainText('Team lead')
  await expect(page.getByText('Team lead', { exact: true })).toHaveCount(1)

  // The lead spans the row; the rest are 3 per row on a computer, 1 on a phone.
  const boxes = await teamCards(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
  const rowOf = (i: number) => boxes.filter((b) => Math.abs(b.top - boxes[i].top) < 2).length
  expect(rowOf(0)).toBe(1)
  expect(rowOf(1)).toBe(info.project.name === 'mobile' ? 1 : 3)
  if (info.project.name === 'desktop') expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 2.5)
  // Cards sharing a row are the same height, and no bio is cut off.
  for (let i = 1; i < boxes.length; i++) {
    const row = boxes.filter((b) => Math.abs(b.top - boxes[i].top) < 2)
    for (const b of row) expect(Math.abs(b.height - boxes[i].height)).toBeLessThan(1)
  }
  const clipped = await teamCards(page).evaluateAll((els) =>
    els.flatMap((el) => [el, ...el.querySelectorAll('*')]).filter((n) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1).length
  )
  expect(clipped).toBe(0)
  await noSidewaysScroll(page)
})

test('every member has a profile picture with alt text', async ({ page }) => {
  await page.goto('/about')
  const pictures = page.locator('[data-team-card] img')
  await expect(pictures).toHaveCount(7)
  await expect(pictures.first()).toHaveAttribute('alt', 'Profile picture of Abrar Saeed Almhari')
  for (const img of await pictures.all()) {
    await img.scrollIntoViewIfNeeded()
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(400)
  }
})

test('falls back to the initials when a picture fails to load', async ({ page }) => {
  await page.route('**/team/*.jpg', (route) => route.abort())
  await page.goto('/about')
  const first = teamCards(page).first()
  await first.scrollIntoViewIfNeeded()
  await expect(first.getByRole('img', { name: 'Profile picture of Abrar Saeed Almhari' })).toHaveText('AA')
  await expect(page.locator('[data-team-card] img')).toHaveCount(0)
})

test('on hover only the grooves spin, and nothing spins with reduced motion', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Phones have no hover')
  const animations = (card: ReturnType<typeof teamCards>) =>
    card.evaluate((el) => {
      const img = el.querySelector('img')!
      const photoChain: string[] = []
      for (let n: Element | null = img; n && n !== el; n = n.parentElement) photoChain.push(getComputedStyle(n).animationName)
      const grooves = img.parentElement!.previousElementSibling!
      return { grooves: getComputedStyle(grooves).animationName, photo: photoChain }
    })

  await page.goto('/about')
  const card = teamCards(page).nth(1)
  await card.hover()
  await expect.poll(async () => (await animations(card)).grooves).toBe('record-spin')
  expect((await animations(card)).photo.every((a) => a === 'none')).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(0, 0)
  await card.hover()
  expect((await animations(card)).grooves).toBe('none')
})

test('the song page has no note about line highlighting', async ({ page }) => {
  const [song] = (await (
    await adminFetch('/rest/v1/songs?select=id&artist_id=not.is.null&order=popularity.desc.nullslast&limit=1')
  ).json()) as { id: string }[]
  // Timed lyrics: the case the note used to appear in.
  await page.route('**/functions/v1/lyrics-lookup', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ found: true, syncedLyrics: '[00:01.00]First timed line\n[00:04.00]Second timed line' }),
    })
  )
  await login(page, user.email)
  await page.goto(`/song/${song.id}`)
  await page.locator('#lyrics button[aria-controls="lyrics-panel"]').click()
  await expect(page.getByText('First timed line')).toBeVisible()
  await expect(page.getByText(/line highlighting/i)).toHaveCount(0)
})
