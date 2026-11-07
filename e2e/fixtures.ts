import { test as base, type BrowserContext, type Route } from '@playwright/test'

export { expect } from '@playwright/test'
export type { Locator, Page, Request, Route } from '@playwright/test'

/**
 * Every spec imports `test` from here, so no test run can reach the real
 * Spotify or use up its quota. e2e/spotify.spec.ts fails if a spec goes around
 * this. A test that wants a particular Spotify answer sets its own page.route:
 * those are tried before these.
 */
export const MOCK_HEADER = 'x-test-mock'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  [MOCK_HEADER]: 'spotify',
}

/** Answers like a Spotify with nothing new, so pages use what's saved. */
function mockAnswer(route: Route, answer: (body: Record<string, unknown>) => unknown) {
  const request = route.request()
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: 'ok' })
  return route.fulfill({
    status: 200,
    headers,
    body: JSON.stringify(answer(request.postDataJSON() ?? {})),
  })
}

export async function blockSpotify(context: BrowserContext) {
  await context.route('**/functions/v1/spotify-search', (route) =>
    mockAnswer(route, ({ type }) =>
      type === 'artist'
        ? { type, artists: [] }
        : { type: 'track', songs: [], cached: 0, artistsWithImages: 0, ranked: 0 }
    )
  )
  await context.route('**/functions/v1/spotify-artist', (route) =>
    mockAnswer(route, ({ action }) => {
      if (action === 'bio') return { bio: null, url: null }
      if (action === 'album') return { tracks: 0, totalTracks: null }
      return { albums: 0, newReleases: 0 }
    })
  )
  // Nothing in the app calls these from the browser. If that changes, it stops here.
  await context.route(/^https:\/\/(api|accounts)\.spotify\.com\//, (route) =>
    route.abort('blockedbyclient')
  )
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await blockSpotify(context)
    await use(context)
  },
})
