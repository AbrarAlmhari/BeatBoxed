import { test, expect, type Page, type Route } from '@playwright/test'
import {
  adminFetch,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  login,
  type PlayableSong,
} from './helpers'

/**
 * Beatie, with both Edge Functions it touches mocked in the browser:
 * `beatie` (so no Gemini quota is ever used) and `lyrics-lookup` (so every
 * test controls exactly which lyrics, if any, the song has).
 *
 * These cover the app's side: what it asks for, and how it shows each answer
 * and each failure. The function's own rules (cache, limits, the lyric-quote
 * check) run on the server and aren't exercised here.
 */

type BeatieBody = {
  action: 'explain' | 'line' | 'translate' | 'chat'
  songId: string
  line?: string
  messages?: { role: string; text: string }[]
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function answer(route: Route, body: unknown, delayMs = 0) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 200, headers: CORS, body: 'ok' })
  }
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
  await route.fulfill({
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Mocks lyrics-lookup. null = no lyrics found. */
async function mockLyrics(page: Page, lines: string[] | null) {
  await page.route(/\/functions\/v1\/lyrics-lookup$/, (route) =>
    answer(
      route,
      lines
        ? { found: true, instrumental: false, plainLyrics: lines.join('\n'), syncedLyrics: null }
        : { found: false, plainLyrics: null, syncedLyrics: null }
    )
  )
}

/** Mocks beatie; records every request it receives. */
async function mockBeatie(
  page: Page,
  reply: (body: BeatieBody) => unknown | Promise<unknown>,
  delayMs = 0
) {
  const calls: BeatieBody[] = []
  await page.route(/\/functions\/v1\/beatie$/, async (route) => {
    if (route.request().method() === 'OPTIONS') return answer(route, null)
    const body = route.request().postDataJSON() as BeatieBody
    calls.push(body)
    await answer(route, await reply(body), delayMs)
  })
  return calls
}

const ok = (extra: Record<string, unknown>) => ({
  ok: true,
  language: 'en',
  hasLyrics: true,
  cached: false,
  ...extra,
})

const EXPLANATION =
  'This one is about leaving a small town and missing it more than expected.\n\nThe verses feel restless, and the chorus softens into something like homesickness.'

const ENGLISH = [
  'I left the light on by the door',
  "Walking out the way I came before",
  'Every road I take still leads back home',
  'Singing to the silence on my own',
]
const SPANISH = [
  'Dejé la luz encendida junto a la puerta',
  'Caminando por donde vine antes',
  'Cada camino me lleva de vuelta a casa',
  'Cantándole al silencio a solas',
]

const beatieCard = (page: Page) => page.getByRole('region', { name: 'Beatie' })

async function openLyrics(page: Page) {
  await page.locator('#lyrics').getByRole('button', { name: 'Lyrics' }).click()
}

async function setLanguage(userId: string, code: string) {
  await adminFetch(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ translation_language: code }),
  })
}

test.describe('Beatie', () => {
  let songs: PlayableSong[]
  let user: { id: string; email: string }

  test.beforeAll(async () => {
    songs = await distinctSongs(2)
    user = await createTestUser('beatie')
  })

  test.beforeEach(async () => {
    await setLanguage(user.id, 'en')
  })

  test.afterAll(async () => {
    await deleteTestUsers()
  })

  test("the explanation card loads: thinking, then Beatie's answer", async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    const calls = await mockBeatie(page, () => ok({ text: EXPLANATION }), 800)
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)

    const card = beatieCard(page)
    await card.getByRole('button', { name: "What's this song about?" }).click()
    await expect(card.getByText('Beatie is thinking…')).toBeVisible()
    await expect(card.getByText('This one is about leaving a small town')).toBeVisible()
    await expect(card.getByText('the chorus softens')).toBeVisible()

    // Only the song id goes up — the server fetches the lyrics itself.
    expect(calls).toEqual([{ action: 'explain', songId: songs[0].id }])
  })

  test('a slow answer says "Still thinking" after 8 seconds', async ({ page }) => {
    // The mock holds the answer for 4 real seconds; the page's clock is
    // fast-forwarded past the 8-second mark meanwhile.
    await page.clock.install()
    await mockLyrics(page, ENGLISH)
    await mockBeatie(page, () => ok({ text: EXPLANATION }), 4000)
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)

    const card = beatieCard(page)
    await card.getByRole('button', { name: "What's this song about?" }).click()
    await expect(card.getByText('Beatie is thinking…')).toBeVisible()
    await page.clock.fastForward(8_500)
    await expect(card.getByText('Still thinking… long songs take a moment')).toBeVisible()
    await expect(card.getByText('This one is about leaving a small town')).toBeVisible()
  })

  test('a follow-up question carries the explanation and the conversation', async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    const calls = await mockBeatie(page, (b) =>
      b.action === 'explain' ? ok({ text: EXPLANATION }) : ok({ text: `Reply ${b.messages?.length}` })
    )
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)

    const card = beatieCard(page)
    await card.getByRole('button', { name: "What's this song about?" }).click()
    await expect(card.getByTestId('beatie-explanation')).toBeVisible()

    await card.getByLabel('Ask Beatie about this song').fill('Is it about a real town?')
    await card.getByRole('button', { name: 'Ask Beatie' }).click()
    await expect(card.getByText('Reply 3')).toBeVisible()

    const chat = calls.find((c) => c.action === 'chat')!
    expect(chat.messages?.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(chat.messages?.[2].text).toBe('Is it about a real town?')
  })

  test('explain a line opens, answers, and closes', async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    const calls = await mockBeatie(page, () => ok({ text: 'The light left on is a promise to come back.' }))
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)
    await openLyrics(page)

    await page.getByRole('button', { name: ENGLISH[0] }).click()
    const panel = page.getByRole('dialog', { name: 'Explain this line' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('blockquote')).toHaveText(ENGLISH[0])
    // Only "Explain this line" — no per-line translate.
    await expect(panel.getByRole('button', { name: /translate/i })).toHaveCount(0)

    await panel.getByRole('button', { name: 'Explain this line' }).click()
    await expect(panel.getByTestId('line-explanation')).toHaveText(
      'The light left on is a promise to come back.'
    )
    expect(calls).toEqual([{ action: 'line', songId: songs[0].id, line: ENGLISH[0] }])

    await panel.getByRole('button', { name: 'Close' }).last().click()
    await expect(panel).toHaveCount(0)

    // Escape closes it too.
    await page.getByRole('button', { name: ENGLISH[1] }).click()
    await expect(page.getByRole('dialog', { name: 'Explain this line' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Explain this line' })).toHaveCount(0)
  })

  test('with no lyrics, Beatie says so and still explains', async ({ page }) => {
    await mockLyrics(page, null)
    await mockBeatie(page, () =>
      ok({
        hasLyrics: false,
        text: "I don't have the lyrics for this one, so I'm going on the title and artist alone.",
      })
    )
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)

    const card = beatieCard(page)
    await card.getByRole('button', { name: "What's this song about?" }).click()
    await expect(card.getByText(/No lyrics found for this song/)).toBeVisible()
    await expect(card.getByText(/I don't have the lyrics for this one/)).toBeVisible()

    await openLyrics(page)
    await expect(page.getByText('Lyrics not found')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Translate to/ })).toHaveCount(0)
  })

  for (const [code, message] of [
    ['limit', "You've used today's 30 Beatie requests"],
    ['busy', 'Beatie is taking a break, try again in a minute.'],
    ['global', 'Beatie is taking a break, try again later.'],
    ['error', "Beatie couldn't answer that right now"],
  ] as const) {
    test(`a "${code}" answer shows a friendly message, never the raw error`, async ({ page }) => {
      await mockLyrics(page, ENGLISH)
      await mockBeatie(page, () => ({ ok: false, code }))
      await login(page, user.email)
      await page.goto(`/song/${songs[0].id}`)

      const card = beatieCard(page)
      await card.getByRole('button', { name: "What's this song about?" }).click()
      await expect(card.getByRole('alert')).toContainText(message)
      await expect(card.getByText(code, { exact: true })).toHaveCount(0)
      // And it can be tried again.
      await expect(card.getByRole('button', { name: "What's this song about?" })).toBeVisible()
    })
  }

  test('Translate shows each line under its original, then back to the original', async ({ page }) => {
    await mockLyrics(page, SPANISH)
    const calls = await mockBeatie(page, (b) =>
      b.action === 'translate' ? ok({ lines: ENGLISH }) : ok({ text: 'x' })
    )
    await login(page, user.email)
    await page.goto(`/song/${songs[1].id}`)
    await openLyrics(page)

    await page.getByRole('button', { name: 'Translate to English' }).click()
    await expect(page.getByText('Translated by Beatie · may not be exact')).toBeVisible()
    const translations = page.getByTestId('lyric-translation')
    await expect(translations).toHaveText(ENGLISH)
    // Each translation sits under its own original line.
    for (let i = 0; i < SPANISH.length; i++) {
      await expect(page.getByRole('button', { name: SPANISH[i] })).toContainText(ENGLISH[i])
    }
    await expect(page.getByRole('link', { name: 'Change language' })).toHaveAttribute('href', '/settings')

    await page.getByRole('button', { name: 'Show original only' }).click()
    await expect(translations).toHaveCount(0)
    await expect(page.getByText('Translated by Beatie · may not be exact')).toHaveCount(0)

    // Back on again without asking a second time.
    await page.getByRole('button', { name: 'Translate to English' }).click()
    await expect(translations).toHaveCount(SPANISH.length)
    expect(calls.filter((c) => c.action === 'translate')).toHaveLength(1)
  })

  test('Translate is hidden when the lyrics are already in your language', async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    await mockBeatie(page, () => ok({ text: 'x' }))
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}`)
    await openLyrics(page)
    await expect(page.getByRole('button', { name: ENGLISH[0] })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Translate to/ })).toHaveCount(0)
  })

  test('Beatie replies in the language chosen in Settings', async ({ page }) => {
    // The mock answers the way the function does: in the user's language
    // from their profile, read fresh on every request.
    await mockLyrics(page, ENGLISH)
    await mockBeatie(page, async () => {
      const [profile] = (await (
        await adminFetch(`/rest/v1/profiles?id=eq.${user.id}&select=translation_language`)
      ).json()) as { translation_language: string | null }[]
      const language = profile?.translation_language || 'en'
      return ok({
        language,
        text: language === 'ar' ? 'هذه الأغنية عن الحنين إلى البيت.' : 'This song is about missing home.',
      })
    })
    await login(page, user.email)

    // Choose Arabic the way a user does.
    await page.goto('/settings')
    await page.getByRole('button', { name: 'العربية' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    await page.goto(`/song/${songs[0].id}`)
    const card = beatieCard(page)
    await card.getByRole('button', { name: "What's this song about?" }).click()
    const reply = card.getByText('هذه الأغنية عن الحنين إلى البيت.')
    await expect(reply).toBeVisible()
    // Shown right to left.
    expect(await reply.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')

    // And the English lyrics now offer a translation into Arabic.
    await openLyrics(page)
    await expect(page.getByRole('button', { name: 'Translate to Arabic' })).toBeVisible()
  })

  test("Home's Ask Beatie: pick a song, and the chat opens", async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    await mockBeatie(page, (b) =>
      b.action === 'explain' ? ok({ text: EXPLANATION }) : ok({ text: 'Happy to dig in.' })
    )
    await login(page, user.email)
    await page.goto('/')

    await page.getByRole('button', { name: /Ask Beatie/ }).first().click()
    const sheet = page.getByRole('dialog', { name: 'Ask Beatie' })
    await expect(sheet).toBeVisible()

    const song = songs[0]
    await sheet.getByRole('combobox').fill(song.title)
    await sheet
      .getByRole('option', { name: new RegExp(song.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      .first()
      .click({ timeout: 30_000 })

    await expect(sheet.getByText(song.title).first()).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Open song page' })).toHaveAttribute(
      'href',
      `/song/${song.id}`
    )
    await sheet.getByRole('button', { name: "What's this song about?" }).click()
    await expect(sheet.getByText('This one is about leaving a small town')).toBeVisible()

    await sheet.getByLabel('Ask Beatie about this song').fill('Who wrote it?')
    await sheet.getByRole('button', { name: 'Ask Beatie' }).click()
    await expect(sheet.getByText('Happy to dig in.')).toBeVisible()
  })

  test("a /song/:id#beatie link, as Now Playing's Ask Beatie uses, lands on the Beatie card", async ({ page }) => {
    await mockLyrics(page, ENGLISH)
    await mockBeatie(page, () => ok({ text: 'x' }))
    await login(page, user.email)
    await page.goto(`/song/${songs[0].id}#beatie`)
    await expect(beatieCard(page)).toBeInViewport()
  })
})
