import { test, expect, type Page } from '@playwright/test'
import {
  createPlaylistWithSongs,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  installAudioProbe,
  login,
  silentWav,
  stubPreviewAudio,
  waitForPlaying,
} from './helpers'
import { ABOUT } from '../src/content/about'

/**
 * The About page's easter egg: tapping a member's record plays their song's
 * preview. The previews are answered locally with a silent clip, so nothing
 * here depends on Apple's servers.
 */

const members = ABOUT.team.members
const abrar = members.find((m) => m.name === 'Abrar Saeed Almhari')!
const saja = members.find((m) => m.name === 'Saja Saad Almajid')!

const record = (page: Page, name: string) => page.getByRole('button', { name: `Play ${name}'s song` })
const stop = (page: Page) => page.getByRole('button', { name: 'Stop' })

/** What the page's audio elements are doing: the source of each one playing. */
const playingSources = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __audios?: HTMLAudioElement[] }).__audios ?? [])
      .filter((a) => !a.paused)
      .map((a) => a.src)
  )

/** Serves every preview as silence; `seconds` sets how long it lasts. */
async function servePreviews(page: Page, seconds = 30, failing: string[] = []) {
  const wav = silentWav(seconds)
  await page.route(/audio-ssl\.itunes\.apple\.com/, async (route) => {
    if (failing.includes(route.request().url())) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', 'content-length': String(wav.length) },
      body: wav,
    })
  })
}

async function open(page: Page) {
  await installAudioProbe(page)
  await page.goto('/about')
  await record(page, abrar.name).scrollIntoViewIfNeeded()
}

test('every member with a song has a play button, and nothing plays on load', async ({ page }) => {
  await servePreviews(page)
  await open(page)
  const withSongs = members.filter((m) => m.song)
  await expect(page.locator('[data-record-button]')).toHaveCount(withSongs.length)
  for (const m of withSongs) await expect(record(page, m.name)).toBeVisible()
  await page.waitForTimeout(500)
  expect(await playingSources(page)).toEqual([])
})

test('tapping a record plays its song; tapping it again stops it', async ({ page }) => {
  await servePreviews(page)
  await open(page)
  await record(page, abrar.name).click()
  await expect(stop(page)).toHaveCount(1)
  await expect.poll(() => playingSources(page)).toEqual([abrar.song!.previewUrl])

  await stop(page).click()
  await expect(record(page, abrar.name)).toBeVisible()
  await expect.poll(() => playingSources(page)).toEqual([])
})

test("all seven have a song, and Fatimah's plays and stops like the others", async ({ page }) => {
  expect(members.filter((m) => m.song)).toHaveLength(7)
  const fatimah = members.find((m) => m.name === 'Fatimah Fadil Aldubibi')!
  await servePreviews(page)
  await open(page)
  await record(page, fatimah.name).click()
  await expect.poll(() => playingSources(page)).toEqual([fatimah.song!.previewUrl])
  await expect(stop(page)).toHaveCount(1)
  await stop(page).click()
  await expect(record(page, fatimah.name)).toBeVisible()
  await expect.poll(() => playingSources(page)).toEqual([])
})

test('tapping another record switches songs: one at a time', async ({ page }) => {
  await servePreviews(page)
  await open(page)
  await record(page, abrar.name).click()
  await expect.poll(() => playingSources(page)).toEqual([abrar.song!.previewUrl])

  await record(page, saja.name).click()
  await expect.poll(() => playingSources(page)).toEqual([saja.song!.previewUrl])
  await expect(stop(page)).toHaveCount(1)
  await expect(record(page, abrar.name)).toBeVisible()
})

test('a link that fails does nothing visible', async ({ page }) => {
  await servePreviews(page, 30, [abrar.song!.previewUrl])
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page)
  await record(page, abrar.name).click()
  await page.waitForTimeout(1500)
  await expect(record(page, abrar.name)).toBeVisible()
  await expect(stop(page)).toHaveCount(0)
  expect(await playingSources(page)).toEqual([])
  expect(errors).toEqual([])
})

test('it stops by itself when the preview ends', async ({ page }) => {
  await servePreviews(page, 1)
  await open(page)
  await record(page, abrar.name).click()
  await expect(stop(page)).toHaveCount(1)
  await expect(record(page, abrar.name)).toBeVisible({ timeout: 10_000 })
})

test('while playing the record spins; with reduced motion it shows a playing badge instead', async ({ page }) => {
  await servePreviews(page)
  await open(page)
  const spinning = () =>
    stop(page).evaluate((el) => el.querySelector('[aria-hidden]')!.getAnimations().length > 0)
  await page.mouse.move(0, 0)
  await record(page, abrar.name).click()
  await expect(stop(page)).toHaveCount(1)
  await expect.poll(spinning).toBe(true)
  await expect(stop(page).locator('[data-playing-badge]')).toBeHidden()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(spinning).toBe(false)
  await expect(stop(page).locator('[data-playing-badge]')).toBeVisible()
})

test.describe('with the app', () => {
  let user: { id: string; email: string }

  test.beforeAll(async ({}, info) => {
    user = await createTestUser(`about-songs-${info.project.name}`)
  })
  test.afterAll(async () => {
    await deleteTestUsers(user.email)
  })

  test("leaving the page stops the song, and the app's player is paused, not played over", async ({ page }) => {
    const songs = await distinctSongs(1)
    await stubPreviewAudio(page, songs)
    await servePreviews(page)
    await login(page, user.email)
    const id = await createPlaylistWithSongs(user.id, 'About Songs', [songs[0].id])
    await page.goto(`/playlist/${id}`)
    await page.getByRole('button', { name: /^Play$/ }).click()
    await waitForPlaying(page)

    // To Settings without a reload, then About through its link, so the
    // player is still going when the page opens.
    await page.evaluate(() => {
      history.pushState({}, '', '/settings')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.getByRole('link', { name: /About BeatBoxed/ }).click()
    await record(page, abrar.name).scrollIntoViewIfNeeded()
    await record(page, abrar.name).click()
    await expect.poll(() => playingSources(page)).toEqual([abrar.song!.previewUrl])

    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect.poll(() => playingSources(page)).toEqual([])
  })
})
