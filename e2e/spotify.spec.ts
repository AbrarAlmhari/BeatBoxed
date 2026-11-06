import { readdirSync, readFileSync } from 'node:fs'
import { test, expect, MOCK_HEADER, type Page, type Route } from './fixtures'
import { env } from './helpers'
import { readSpotifyFailure, spotifyFailureBody } from '../supabase/functions/_shared/spotifyFailure'

/**
 * Spotify's answers, the note in Explore, and the mock that keeps test runs
 * away from the real Spotify.
 *
 * Nothing here reaches Supabase or Spotify: the browser gets a made-up session
 * and every backend request is answered below, so these tests create no
 * accounts and change no rows.
 */

const NOTE = 'Spotify search is unavailable right now, showing saved results.'
const REFUSAL =
  'Active premium subscription required for the owner of the app. When the subscription status changes, it can take a few hours before requests are allowed again.'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const ARTIST_ID = '00000000-0000-4000-8000-000000000002'
const ALBUM_ID = '00000000-0000-4000-8000-000000000003'

const artistRow = {
  id: ARTIST_ID,
  spotify_id: 'mock-artist',
  name: 'Mock Artist',
  image_url: null,
  genres: [],
  genre_buckets: [],
  bio: null,
  bio_url: null,
  bio_fetched_at: null,
  genres_fetched_at: new Date().toISOString(),
  discography_synced_at: null,
}
const albumRow = {
  id: ALBUM_ID,
  spotify_id: 'mock-album',
  title: 'Mock Album',
  cover_url: null,
  release_date: '2020-01-01',
  total_tracks: 5,
  album_type: 'album',
  artist_id: ARTIST_ID,
  artists: { id: ARTIST_ID, name: 'Mock Artist' },
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Signed in as nobody real, with no request reaching the backend. */
async function goOffline(page: Page) {
  const session = {
    access_token: `e30.${Buffer.from(JSON.stringify({ sub: USER_ID, exp: 4102444800 })).toString('base64url')}.x`,
    refresh_token: 'mock',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    user: { id: USER_ID, aud: 'authenticated', email: 'mock@beatboxed.test', app_metadata: {}, user_metadata: {} },
  }
  const key = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)])
  await page.routeWebSocket(/\/realtime\//, () => {})

  const profile = {
    id: USER_ID,
    username: 'mock',
    display_name: 'Mock',
    setup_completed_at: new Date().toISOString(),
    welcome_card_dismissed_at: new Date().toISOString(),
  }
  await page.route(`${env.VITE_SUPABASE_URL}/**`, async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, {})
    if (/\/functions\/v1\/spotify-/.test(pathname)) return route.fallback()

    const one = (request.headers().accept ?? '').includes('vnd.pgrst.object')
    const answer = (row: object) => json(route, one ? row : [row])
    if (pathname.startsWith('/auth/v1/user')) return json(route, session.user)
    if (pathname === '/rest/v1/profiles') return answer(profile)
    if (request.method() === 'GET' && pathname === '/rest/v1/artists') return answer(artistRow)
    if (request.method() === 'GET' && pathname === '/rest/v1/albums') {
      return request.url().includes(`id=eq.${ALBUM_ID}`) ? answer(albumRow) : json(route, [])
    }
    return one ? json(route, null) : json(route, [])
  })
}

/** Types into Explore's search, which asks Spotify because nothing is saved. */
async function search(page: Page, text = 'nothing saved matches this') {
  await page.goto('/explore')
  await page.getByRole('searchbox', { name: 'Search' }).fill(text)
}

const note = (page: Page) => page.getByRole('main').getByText(NOTE)

/** Counts one Spotify action's requests and answers each with `status`. */
async function countCalls(page: Page, action: string, status: number) {
  const calls = { count: 0 }
  await page.route('**/functions/v1/spotify-artist', (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {})
    if (route.request().postDataJSON()?.action !== action) return route.fallback()
    calls.count++
    return json(route, status === 200 ? {} : { error: `Spotify ${status}` }, status)
  })
  return calls
}

test.describe("Spotify's reason", () => {
  test('reads the plain text refusal the app gets without Premium', async () => {
    const failure = await readSpotifyFailure(new Response(REFUSAL, { status: 403 }))
    expect(failure).toEqual({ status: 403, reason: REFUSAL, code: null, retryAfterSeconds: null })
  })

  test('reads the Web API error shape, with its code', async () => {
    const failure = await readSpotifyFailure(
      new Response(JSON.stringify({ error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }), {
        status: 403,
      })
    )
    expect(failure).toMatchObject({ reason: 'Premium required', code: 'PREMIUM_REQUIRED' })
  })

  test('passes Retry-After along when Spotify sends it', async () => {
    const failure = await readSpotifyFailure(
      new Response(JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded' } }), {
        status: 429,
        headers: { 'Retry-After': '120' },
      })
    )
    expect(failure).toMatchObject({ status: 429, reason: 'API rate limit exceeded', retryAfterSeconds: 120 })
  })

  test('leaves out what explains nothing, and keeps it short', async () => {
    const html = await readSpotifyFailure(new Response('<html>Bad gateway</html>', { status: 502 }))
    expect(html.reason).toBeNull()
    const empty = await readSpotifyFailure(new Response('', { status: 500, headers: { 'Retry-After': 'soon' } }))
    expect(empty).toEqual({ status: 500, reason: null, code: null, retryAfterSeconds: null })
    const long = await readSpotifyFailure(new Response('x'.repeat(1000), { status: 403 }))
    expect(long.reason).toHaveLength(300)
  })

  test("the function's answer says what happened", async () => {
    const failure = { status: 403, reason: REFUSAL, code: null, retryAfterSeconds: null }
    expect(spotifyFailureBody('Spotify search', failure)).toEqual({
      error: `Spotify search failed: 403. ${REFUSAL}`,
      spotify: failure,
    })
    expect(spotifyFailureBody('Spotify search', { ...failure, reason: null }).error).toBe('Spotify search failed: 403')
  })
})

test.describe('the note in Explore', () => {
  test.beforeEach(async ({ page }) => {
    await goOffline(page)
  })

  test("says search is unavailable, and logs Spotify's reason", async ({ page }) => {
    const logged: string[] = []
    page.on('console', async (message) => {
      if (message.type() !== 'error') return
      const values = await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => '')))
      logged.push(JSON.stringify(values))
    })
    await page.route('**/functions/v1/spotify-search', (route) =>
      json(route, spotifyFailureBody('Spotify search', { status: 403, reason: REFUSAL, code: null, retryAfterSeconds: null }), 502)
    )
    await search(page)
    await expect(note(page)).toBeVisible()
    await expect(page.getByRole('main').getByText("Couldn't reach Spotify")).toHaveCount(0)
    // The reason is for us: the page doesn't talk about the owner's subscription.
    await expect(page.getByRole('main').getByText(/premium/i)).toHaveCount(0)
    await expect.poll(() => logged.join(' ')).toContain('Active premium subscription required')
  })

  test('shows with the short answer the function gives before its redeploy', async ({ page }) => {
    await page.route('**/functions/v1/spotify-search', (route) =>
      json(route, { error: 'Spotify search failed: 403' }, 502)
    )
    await search(page)
    await expect(note(page)).toBeVisible()
  })

  test('shows when the function cannot be reached', async ({ page }) => {
    await page.route('**/functions/v1/spotify-search', (route) => route.abort('failed'))
    await search(page)
    await expect(note(page)).toBeVisible()
  })

  test('shows once a slow answer runs out of time', async ({ page }) => {
    await page.route('**/functions/v1/spotify-search', () => new Promise(() => {}))
    await search(page)
    await expect(note(page)).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('the mock', () => {
  test.beforeEach(async ({ page }) => {
    await goOffline(page)
  })

  test('answers a search, so the page shows no note', async ({ page }) => {
    const answered = page.waitForResponse(
      (res) => res.url().includes('/functions/v1/spotify-search') && res.request().method() === 'POST'
    )
    await search(page)
    expect((await answered).headers()[MOCK_HEADER]).toBe('spotify')
    await expect(page.getByRole('main').getByText(/no results|nothing/i).first()).toBeVisible()
    await expect(note(page)).toHaveCount(0)
  })

  test('answers artist and album pages', async ({ page }) => {
    const answered = (action: string) =>
      page.waitForResponse(
        (res) => res.url().includes('/functions/v1/spotify-artist') && res.request().postDataJSON()?.action === action
      )
    const discography = answered('discography')
    await page.goto(`/artist/${ARTIST_ID}`)
    expect((await discography).headers()[MOCK_HEADER]).toBe('spotify')
    await expect(page.getByRole('heading', { name: 'Mock Artist' })).toBeVisible()
    await expect(page.getByText(/^Spotify is unavailable/)).toHaveCount(0)
    const album = answered('album')
    await page.goto(`/album/${ALBUM_ID}`)
    expect((await album).headers()[MOCK_HEADER]).toBe('spotify')
    await expect(page.getByRole('heading', { name: 'Mock Album' })).toBeVisible()
    await expect(page.getByText(/^Spotify is unavailable/)).toHaveCount(0)
  })

  test('every spec goes through it', async () => {
    const dir = new URL('./', import.meta.url)
    const specs = readdirSync(dir).filter((name) => name.endsWith('.spec.ts'))
    expect(specs.length).toBeGreaterThan(30)
    for (const name of specs) {
      const source = readFileSync(new URL(name, dir), 'utf8')
      expect(source, `${name} imports from fixtures`).toContain("from './fixtures'")
      expect(source, `${name} skips the mock`).not.toMatch(/from '@playwright\/test'/)
      expect(source, `${name} opens a browser the mock doesn't cover`).not.toMatch(/\bbrowser\.newContext\b/)
    }
  })
})

test.describe('a refused sync', () => {
  test.beforeEach(async ({ page }) => {
    await goOffline(page)
  })

  test('an artist page asks Spotify once, not over and over, and says so', async ({ page }) => {
    const discography = await countCalls(page, 'discography', 502)
    const bio = await countCalls(page, 'bio', 502)
    await page.goto(`/artist/${ARTIST_ID}`)
    await expect(page.getByRole('heading', { name: 'Mock Artist' })).toBeVisible()
    await expect(page.getByText('Spotify is unavailable right now, showing saved albums.')).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(discography.count).toBe(1)
    expect(bio.count).toBe(1)
  })

  test('an album page asks Spotify once, not over and over, and says so', async ({ page }) => {
    const album = await countCalls(page, 'album', 502)
    await page.goto(`/album/${ALBUM_ID}`)
    await expect(page.getByRole('heading', { name: 'Mock Album' })).toBeVisible()
    await expect(page.getByText('Spotify is unavailable right now, showing saved tracks.')).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(album.count).toBe(1)
  })
})
