import { test, expect, type Page } from './fixtures'
import {
  adminFetch,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  env,
  login,
  makeFollow,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * For You's variety (migration 0055): one author's batch is spread out, older
 * reviews sink slowly but stay, a session's shuffle is fixed so paging never
 * repeats or skips, reviews this device scrolled past sink, and Following
 * stays strictly newest first. The database checks run against the real feed
 * (everyone's reviews), as a signed-in test account.
 */

const MIN = 20
const long = (tag: string) => `${tag}: the second verse turns the whole song around for me.`

type Row = { review_id: string; created_at: string; score: number }

let viewer: { id: string; email: string; token: string }
let batch: { id: string; email: string }
let other1: { id: string; email: string }
let other2: { id: string; email: string }
let songs: PlayableSong[]
const batchIds: string[] = []
let other1Id: string
let other2Id: string
let oldId: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({}, info) => {
  const p = info.project.name
  const v = await createTestUser(`fv-viewer-${p}`)
  viewer = { ...v, token: await tokenFor(v.email) }
  batch = await createTestUser(`fv-batch-${p}`)
  other1 = await createTestUser(`fv-one-${p}`)
  other2 = await createTestUser(`fv-two-${p}`)
  songs = await distinctSongs(10)
  // One author posts five in a row; two others one each, just after.
  for (let i = 0; i < 5; i++) batchIds.push(await createReview(batch.id, songs[i].id, 4, long(`Batch ${i}`)))
  other1Id = await createReview(other1.id, songs[5].id, 4, long('Other one'))
  other2Id = await createReview(other2.id, songs[6].id, 4, long('Other two'))
  // Three weeks old: it should sink, not vanish.
  oldId = await createReview(other1.id, songs[7].id, 4, long('Old one'))
  const weeksAgo = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString()
  await adminFetch(`/rest/v1/reviews?id=eq.${oldId}`, {
    method: 'PATCH',
    body: JSON.stringify({ created_at: weeksAgo }),
  })
})

test.afterAll(async () => {
  await deleteTestUsers(viewer.email)
  await deleteTestUsers(batch.email)
  await deleteTestUsers(other1.email)
  await deleteTestUsers(other2.email)
})

/** feed_for_you_mixed as the viewer. */
async function mixed(opts: {
  asOf: string
  seed: number
  seen?: string[]
  after?: Row | null
  size?: number
}): Promise<Row[]> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/feed_for_you_mixed`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${viewer.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      min_chars: MIN,
      as_of: opts.asOf,
      seed: opts.seed,
      seen_ids: opts.seen ?? [],
      after_score: opts.after?.score ?? null,
      after_id: opts.after?.review_id ?? null,
      page_size: opts.size ?? 20,
    }),
  })
  expect(res.ok, await res.clone().text()).toBe(true)
  return (await res.json()) as Row[]
}

/** The whole feed, page by page. */
async function everything(asOf: string, seed: number, size: number, seen: string[] = []) {
  const out: Row[] = []
  let after: Row | null = null
  for (;;) {
    const page = await mixed({ asOf, seed, seen, after, size })
    out.push(...page)
    if (page.length < size) return out
    after = page[page.length - 1]
  }
}

const ids = (rows: Row[]) => rows.map((r) => r.review_id)

test.describe('the database function', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'Same function on both layouts; checked once')
    // These walk the whole real feed, a few dozen calls each.
    test.setTimeout(240_000)
  })

  test("one author's batch is spread out; the others come before their second review", async () => {
    const asOf = new Date().toISOString()
    for (const seed of [1, 2, 3]) {
      const order = ids(await everything(asOf, seed, 50))
      const positions = batchIds.map((id) => order.indexOf(id)).sort((a, b) => a - b)
      // All five are still in the feed: spreading only reorders.
      expect(positions.every((p) => p >= 0)).toBe(true)
      const second = positions[1]
      expect(order.indexOf(other1Id)).toBeLessThan(second)
      expect(order.indexOf(other2Id)).toBeLessThan(second)
    }
  })

  test('pages of 3 line up with one long page: nothing repeats, nothing is skipped', async () => {
    const asOf = new Date().toISOString()
    const small: Row[] = []
    let after: Row | null = null
    for (let i = 0; i < 10; i++) {
      const page = await mixed({ asOf, seed: 7, after, size: 3 })
      expect(page).toHaveLength(3)
      small.push(...page)
      after = page[2]
    }
    const one = await mixed({ asOf, seed: 7, size: 30 })
    expect(ids(small)).toEqual(ids(one))
    expect(new Set(ids(small)).size).toBe(30)
  })

  test('the same seed gives the same order; another seed, the same reviews in a different mix', async () => {
    const asOf = new Date().toISOString()
    const a = ids(await everything(asOf, 11, 50))
    const again = ids(await everything(asOf, 11, 50))
    const b = ids(await everything(asOf, 12, 50))
    expect(again).toEqual(a)
    expect(new Set(a).size).toBe(a.length)
    expect([...b].sort()).toEqual([...a].sort())
    expect(b).not.toEqual(a)
  })

  test('a three-week-old review sinks but is still in the feed', async () => {
    const order = ids(await everything(new Date().toISOString(), 5, 50))
    const at = order.indexOf(oldId)
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(order.indexOf(other1Id))
  })

  test('a review seen on this device sinks, and stays in the feed', async () => {
    const asOf = new Date().toISOString()
    const before = ids(await everything(asOf, 9, 50))
    const after = ids(await everything(asOf, 9, 50, [other2Id]))
    expect(after.indexOf(other2Id)).toBeGreaterThan(before.indexOf(other2Id))
    expect([...after].sort()).toEqual([...before].sort())
  })

  test('Following stays strictly newest first, batches and all', async () => {
    await makeFollow(viewer.id, batch.id)
    await makeFollow(viewer.id, other1.id)
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/feed_following`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${viewer.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ min_chars: MIN, before_at: null, before_id: null, page_size: 50 }),
    })
    const rows = (await res.json()) as { review_id: string; created_at: string }[]
    const times = rows.map((r) => r.created_at)
    expect(times).toEqual([...times].sort().reverse())
    // The batch sits together, as posted.
    expect(rows.slice(0, 3).map((r) => r.review_id)).toEqual(
      [other1Id, ...batchIds.slice(3).reverse()].slice(0, 3)
    )
  })
})

/** The For You requests the page makes, as they're sent. */
function forYouRequests(page: Page) {
  const sent: { as_of: string; seed: number; seen_ids: string[]; after_score: number | null }[] = []
  page.on('request', (req) => {
    if (req.url().includes('/rpc/feed_for_you_mixed')) sent.push(JSON.parse(req.postData() ?? '{}'))
  })
  return sent
}

test.describe('the app', () => {
  test('one scrolling session sends the same time, seed and seen list with every page', async ({ page }) => {
    const sent = forYouRequests(page)
    await login(page, viewer.email)
    await page.goto('/')
    await expect(page.locator('article[data-review-id]').first()).toBeVisible()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    for (let i = 0; i < 6 && !sent.some((r) => r.after_score !== null); i++) {
      await page.locator('article[data-review-id]').last().evaluate((el) => el.scrollIntoView())
      await page.mouse.wheel(0, 4000)
      await page.waitForTimeout(500)
    }
    // A later page carries its session's first-page time, seed and seen
    // list (development can send the first page twice, a session each).
    await expect.poll(() => sent.some((r) => r.after_score !== null)).toBe(true)
    const later = sent.find((r) => r.after_score !== null)!
    const first = sent.filter((r) => r.after_score === null)
    expect(first.length).toBeGreaterThan(0)
    expect(
      first.some((f) => f.as_of === later.as_of && f.seed === later.seed && JSON.stringify(f.seen_ids) === JSON.stringify(later.seen_ids))
    ).toBe(true)
  })

  test('cards scrolled past are remembered on this device and sent on the next visit', async ({ page }) => {
    await login(page, viewer.email)
    await page.goto('/')
    const cards = page.locator('article[data-review-id]')
    await expect(cards.nth(4)).toBeVisible()
    // Development loads the first page twice; let the list settle first.
    await page.waitForLoadState('networkidle')
    const firstIds = await cards.evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-review-id')))
    // Scrolled like a person: the first cards pass up off the top.
    await page.mouse.move(200, 400)
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, 250)
      await page.waitForTimeout(120)
    }
    // Saved in a batch a few seconds later (or straight away when hidden).
    await expect
      .poll(
        () =>
          page.evaluate(
            (key) => Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}')),
            `beatboxed:seen-reviews:${viewer.id}`
          ),
        { timeout: 10_000 }
      )
      .toEqual(expect.arrayContaining(firstIds))

    const sent = forYouRequests(page)
    await page.reload()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    expect(sent[0].seen_ids).toEqual(expect.arrayContaining(firstIds))
  })

  test('with storage blocked, the feed still loads, scrolls and pages', async ({ page }) => {
    // Only the seen list's storage fails (signing in keeps its own).
    await page.addInitScript(() => {
      const { getItem, setItem } = Storage.prototype
      Storage.prototype.getItem = function (key: string) {
        if (key.startsWith('beatboxed:seen-reviews:')) throw new DOMException('blocked', 'SecurityError')
        return getItem.call(this, key)
      }
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith('beatboxed:seen-reviews:')) throw new DOMException('blocked', 'SecurityError')
        return setItem.call(this, key, value)
      }
    })
    const sent = forYouRequests(page)
    await login(page, viewer.email)
    await page.goto('/')
    const cards = page.locator('article[data-review-id]')
    await expect(cards.first()).toBeVisible()
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    expect(sent[0].seen_ids).toEqual([])
    for (let i = 0; i < 6 && !sent.some((r) => r.after_score !== null); i++) {
      await cards.last().evaluate((el) => el.scrollIntoView())
      await page.mouse.wheel(0, 4000)
      await page.waitForTimeout(500)
    }
    expect(sent.some((r) => r.after_score !== null)).toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })
})
