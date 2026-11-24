import { expect, test } from './fixtures'
import { adminFetch, createTestUser, deleteTestUsers } from './helpers'

/**
 * Song of the week: copies of one song (album, deluxe, single...) count as
 * one song (0062). Asks weekly_song_choice() directly, which picks without
 * storing anything, so no real week is touched.
 *
 * The test songs sit under an existing artist (no artist rows are created or
 * removed) and have no album. Their reviews are dated around 2001, so no
 * real review falls in the week being picked. Only the rows made here are
 * removed afterwards, by id.
 */

const tag = Date.now().toString(36)
const title = `Copy Check ${tag}`
const WEEK = '2001-01-08T00:00:00Z' // the pick counts reviews from Jan 1 to Jan 7
const IN_WEEK = '2001-01-03T12:00:00Z'
const LONG_AGO = '1999-06-01T12:00:00Z'

const made = { songs: [] as string[], reviews: [] as string[], emails: [] as string[] }
let albumCopy = '' // 3 ratings in the week
let deluxeCopy = '' // 4 older reviews: the most reviewed copy
let liveVersion = '' // 3 lower ratings in the week; a different performance

async function insert(path: string, body: unknown) {
  const res = await adminFetch(path, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) })
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error(`insert into ${path} failed: ${JSON.stringify(rows)}`)
  return rows as { id: string }[]
}

async function choose(past: string[]) {
  const res = await adminFetch('/rest/v1/rpc/weekly_song_choice', {
    method: 'POST',
    body: JSON.stringify({ p_starts_at: WEEK, p_past: past }),
  })
  const rows = (await res.json()) as { song_id: string; reason: string; rating_count: number }[]
  if (!Array.isArray(rows)) throw new Error(`weekly_song_choice failed: ${JSON.stringify(rows)}`)
  return rows[0]
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'database check, runs once')

  const [artist] = (await (
    await adminFetch('/rest/v1/artists?select=id&spotify_id=not.like.e2e-*&order=id.asc&limit=1')
  ).json()) as { id: string }[]
  if (!artist) throw new Error('no artist to attach the test songs to')

  const song = async (t: string, ms: number, n: number) =>
    (await insert('/rest/v1/songs', {
      spotify_id: `e2e-copies-${tag}-${n}`, title: t, artist_id: artist.id, duration_ms: ms, popularity: 0,
    }))[0].id
  albumCopy = await song(`${title} (feat. Test Guest)`, 200_000, 1)
  deluxeCopy = await song(`${title} (feat. Test Guest) - Remastered 2011`, 200_400, 2)
  liveVersion = await song(`${title} - Live`, 230_000, 3)
  made.songs.push(albumCopy, deluxeCopy, liveVersion)
  // New songs join the labelling queue on insert; these never need labels.
  await adminFetch(`/rest/v1/song_vibe_queue?song_id=in.(${made.songs.join(',')})`, { method: 'DELETE' })

  const users = []
  for (let i = 1; i <= 4; i++) {
    const u = await createTestUser(`copies-${tag}-${i}`)
    made.emails.push(u.email)
    users.push(u.id)
  }
  const reviews = [
    ...users.slice(0, 3).map((u) => ({ user_id: u, song_id: albumCopy, rating: 5, created_at: IN_WEEK })),
    ...users.slice(0, 3).map((u) => ({ user_id: u, song_id: liveVersion, rating: 3, created_at: IN_WEEK })),
    ...users.map((u) => ({ user_id: u, song_id: deluxeCopy, rating: 4, created_at: LONG_AGO })),
  ]
  made.reviews.push(...(await insert('/rest/v1/reviews', reviews)).map((r) => r.id))
})

test.afterAll(async ({}, info) => {
  if (info.project.name !== 'desktop') return
  test.setTimeout(120_000)
  if (made.reviews.length) await adminFetch(`/rest/v1/reviews?id=in.(${made.reviews.join(',')})`, { method: 'DELETE' })
  if (made.songs.length) await adminFetch(`/rest/v1/songs?id=in.(${made.songs.join(',')})`, { method: 'DELETE' })
  for (const email of made.emails) await deleteTestUsers(email)
})

test('copies of one song: only one copy can be picked, the most reviewed one', async () => {
  const c = await choose([])
  // The album copy has the week's ratings, so its song wins; the deluxe copy
  // has the most reviews overall, so it is the copy shown.
  expect(c.reason).toBe('most_rated')
  expect(c.rating_count).toBe(3)
  expect(c.song_id).toBe(deluxeCopy)
})

test('once one copy has won, no copy of it can win again', async () => {
  for (const past of [[albumCopy], [deluxeCopy]]) {
    const c = await choose(past)
    expect(c.song_id).not.toBe(albumCopy)
    expect(c.song_id).not.toBe(deluxeCopy)
    // The live version is a different performance, so it can still win.
    expect(c.song_id).toBe(liveVersion)
  }
})

test('with every version won, the pick falls back to Trending, never a copy', async () => {
  const c = await choose([albumCopy, liveVersion])
  expect(c.reason).toBe('trending')
  expect([albumCopy, deluxeCopy, liveVersion]).not.toContain(c.song_id)
})
