import { test, expect, type Page } from '@playwright/test'
import { createReview, createTestUser, deleteTestUsers, distinctSongs, login, type PlayableSong } from './helpers'

/**
 * The app's fonts: our own files, nothing from Google; Sora on titles, Inter on
 * everything else, and IBM Plex Sans Arabic for Arabic letters wherever they
 * turn up, including in the middle of an English line.
 */
let user: { id: string; email: string }
let songs: PlayableSong[]

const MIXED = 'Is "Hey Jude" better than this? الأغنية جميلة جداً وكل كلمة فيها حنين، 5 stars.'
const LONG_WORD = 'ا'.repeat(120)

test.beforeAll(async ({}, info) => {
  user = await createTestUser(`fonts-${info.project.name}`)
  songs = await distinctSongs(2)
  await createReview(user.id, songs[0].id, 5, MIXED)
  await createReview(user.id, songs[1].id, 4, `${LONG_WORD} هذه مراجعة طويلة جداً بكلمة لا تنتهي.`)
})

test.afterAll(async () => {
  await deleteTestUsers(user.email)
})

const family = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)

/** Which faces this page has actually downloaded and used. */
const loadedFaces = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight}`)
  })

test('nothing comes from Google, and the two preloads are real files', async ({ page }) => {
  const google: string[] = []
  page.on('request', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) google.push(r.url())
  })
  await login(page, user.email)
  await page.goto('/')
  await expect(page.locator('h1').first()).toBeAttached()
  await page.waitForLoadState('networkidle')
  expect(google).toEqual([])

  const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((els) => els.map((e) => (e as HTMLLinkElement).href))
  expect(preloads).toHaveLength(2)
  for (const href of preloads) expect((await page.request.get(href)).ok()).toBe(true)
  const faces = await loadedFaces(page)
  expect(faces).toEqual(expect.arrayContaining(['Inter 400']))
  expect(faces.some((f) => f.startsWith('Sora '))).toBe(true)
})

test('titles use Sora and body text uses Inter, with the Song of the Week title and countdown', async ({ page }) => {
  await login(page, user.email)
  await page.goto('/')
  const week = page.locator('[data-week-left]').first()
  await expect(week).toBeVisible()
  expect(await page.locator('body').evaluate((b) => getComputedStyle(b).fontFamily)).toMatch(/^"?Inter/)
  expect(await week.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums')
  const title = page.locator('a.font-heading.line-clamp-2').first()
  await expect(title).toBeVisible()
  expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Sora/)

  await page.goto(`/profile/${user.id}`)
  await expect(page.locator('h1').first()).toBeVisible()
  expect(await family(page, 'h1')).toMatch(/^"?Sora/)
})

test('an Arabic review with English in it uses IBM Plex Sans Arabic and Inter together', async ({ page }) => {
  await login(page, user.email)
  await page.goto(`/profile/${user.id}`)
  await expect(page.getByText('الأغنية جميلة جداً', { exact: false })).toBeVisible()
  await expect.poll(() => loadedFaces(page)).toEqual(expect.arrayContaining(['IBM Plex Sans Arabic 400', 'Inter 400']))
})

test('a very long Arabic word stays inside the page', async ({ page }) => {
  await login(page, user.email)
  await page.goto(`/profile/${user.id}`)
  await expect(page.getByText('هذه مراجعة طويلة', { exact: false })).toBeVisible()
  const { width, inner } = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, inner: window.innerWidth }))
  expect(width).toBeLessThanOrEqual(inner)
})

test('there is no font preview switch', async ({ page }) => {
  await login(page, user.email)
  await page.goto('/?fonts=2&glow=off')
  await expect(page.locator('h1').first()).toBeAttached()
  expect(await page.locator('html').getAttribute('data-fonts')).toBeNull()
  expect(await page.locator('html').getAttribute('data-glow')).toBeNull()
  expect(await page.locator('body').evaluate((b) => getComputedStyle(b).fontFamily)).toMatch(/^"?Inter/)
})
