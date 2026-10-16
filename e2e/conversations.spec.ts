import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  adminFetch,
  commentAs,
  createReview,
  createTestUser,
  deleteTestUsers,
  distinctSongs,
  env,
  likeCommentAs,
  login,
  makeFollow,
  nameUser,
  notificationsOf,
  readLoggedOut,
  setPrivate,
  tokenFor,
  type PlayableSong,
} from './helpers'

/**
 * Conversations: replies one level deep, likes on comments, @mentions
 * (picked or typed), the notifications they make, and comment privacy.
 *
 * Fixtures are written through the API as real signed-in users wherever
 * the database's own rules are part of what's tested (mentions,
 * notifications); the UI is then checked on both layouts: a sheet on a
 * phone, the thread inside the card on desktop.
 */

const tag = Date.now().toString(36).slice(-4)
type Person = { id: string; email: string; token: string; username: string; name: string }

async function person(role: string, name: string): Promise<Person> {
  const u = await createTestUser(`conv-${role}`)
  const username = `${role}${tag}`.toLowerCase().slice(0, 20)
  await nameUser(u.id, username, name)
  return { ...u, token: await tokenFor(u.email), username, name }
}

/** Opens a review's comments: the sheet on a phone, the card's thread on desktop. */
async function openThread(page: Page, songId: string, reviewId: string): Promise<Locator> {
  await page.goto(`/song/${songId}?review=${reviewId}`)
  const card = page.locator(`article[data-review-id="${reviewId}"]`)
  await card.getByRole('button', { name: /comments?$/i }).first().click()
  const sheet = page.getByRole('dialog')
  const scope = (await sheet.count()) > 0 ? sheet : card
  await expect(scope.getByRole('list', { name: 'Comments' }).or(scope.getByText('No comments yet'))).toBeVisible()
  return scope
}

/** One comment row, by its text. */
const commentRow = (scope: Locator, text: string | RegExp) =>
  scope.locator('[data-comment-id]').filter({ hasText: text }).first()

let songs: PlayableSong[]
let author: Person, toji: Person, truly: Person, ory: Person

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  songs = await distinctSongs(10)
  author = await person('cvauthor', 'Abrar')
  toji = await person('cvtoji', 'Toji')
  truly = await person('cvtruly', 'TrulyMe')
  ory = await person('cvory', 'ory')
})

test.afterAll(async () => {
  await deleteTestUsers()
})

test('typed mentions become chips that link to the profile; unknown names stay plain text', async ({ page }) => {
  const review = await createReview(author.id, songs[0].id, 5, 'A review to talk about.')
  const typed = await commentAs(
    toji.token,
    review,
    toji.id,
    `hey @${truly.username.toUpperCase()}, and @${truly.username}! and @${truly.username}? also @nobody${tag} and @${truly.username}.`
  )

  // Stored as one mention, four times in the text; one notification.
  const tokens = typed.body.match(/<@[0-9a-f-]{36}>/g) ?? []
  expect(tokens).toHaveLength(4)
  expect(typed.body).toContain(`@nobody${tag}`)
  expect(typed.body.endsWith('>.')).toBe(true)
  const mentions = (await notificationsOf(truly.id)).filter((n) => n.type === 'mention')
  expect(mentions).toHaveLength(1)

  await login(page, author.email)
  const scope = await openThread(page, songs[0].id, review)
  const row = commentRow(scope, 'also')
  const chips = row.getByRole('link', { name: `@${truly.username}` })
  await expect(chips).toHaveCount(4)
  await expect(chips.first()).toHaveAttribute('href', `/profile/${truly.id}`)
  // The unknown name is just text.
  await expect(row.getByRole('link', { name: `@nobody${tag}` })).toHaveCount(0)
  await expect(row).toContainText(`@nobody${tag}`)
})

test('liking a comment counts straight away, survives a reload, and goes back if saving fails', async ({ page }) => {
  const review = await createReview(author.id, songs[1].id, 4, 'Another review.')
  await commentAs(toji.token, review, toji.id, 'the bridge alone')

  await login(page, ory.email)
  let scope = await openThread(page, songs[1].id, review)
  let row = commentRow(scope, 'the bridge alone')
  const like = row.getByRole('button', { name: /^Like Toji's comment/ })
  // The count changes before the save finishes; wait for the save so the
  // reload below proves it was stored.
  const saved = page.waitForResponse((r) => r.url().includes('/comment_likes') && r.request().method() === 'POST')
  await like.click()
  await expect(row.getByRole('button', { name: /^Unlike Toji's comment/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(row.getByRole('button', { name: /Toji's comment/ })).toContainText('1')
  expect((await saved).ok()).toBe(true)

  scope = await openThread(page, songs[1].id, review)
  row = commentRow(scope, 'the bridge alone')
  await expect(row.getByRole('button', { name: /^Unlike Toji's comment/ })).toContainText('1')

  // Saving fails: the count goes back and a message says so.
  await page.route('**/rest/v1/comment_likes**', (r) => r.fulfill({ status: 500, body: '{}' }))
  await row.getByRole('button', { name: /^Unlike Toji's comment/ }).click()
  await expect(page.getByText("Couldn't save that like. Try again.")).toBeVisible()
  await expect(row.getByRole('button', { name: /^Unlike Toji's comment/ })).toContainText('1')
})

test('the review author liking a comment shows "Loved by author" to everyone', async ({ page }) => {
  const review = await createReview(author.id, songs[2].id, 5, 'Loved-by test.')
  const c = await commentAs(toji.token, review, toji.id, 'this one is special')
  await likeCommentAs(author.token, c.id, author.id)

  await login(page, ory.email)
  const scope = await openThread(page, songs[2].id, review)
  await expect(commentRow(scope, 'this one is special')).toContainText('Loved by author')
})

test('replies: a reply to a reply goes under the same comment with @name, two show, then View more and Hide', async ({ page }) => {
  const review = await createReview(author.id, songs[3].id, 5, 'Thread test.')
  const top = await commentAs(toji.token, review, toji.id, 'start of the thread')
  const r1 = await commentAs(truly.token, review, truly.id, 'first reply', top.id)
  await commentAs(ory.token, review, ory.id, 'second reply', top.id)

  await login(page, author.email)
  let scope = await openThread(page, songs[3].id, review)
  // Reply to TrulyMe's reply.
  await commentRow(scope, 'first reply').getByRole('button', { name: 'Reply', exact: true }).click()
  const box = scope.getByRole('combobox', { name: `Reply to @${truly.username}` })
  await expect(box).toHaveValue(`@${truly.username} `)
  await box.pressSequentially('agreed')
  await box.press('Enter')

  // It sits under the top-level comment, not under the reply.
  await expect.poll(async () => {
    const rows = (await (
      await adminFetch(`/rest/v1/review_comments?review_id=eq.${review}&body=like.*agreed*&select=parent_id,reply_to_id`)
    ).json()) as { parent_id: string; reply_to_id: string }[]
    return rows[0] ?? null
  }).toEqual({ parent_id: top.id, reply_to_id: r1.id })

  scope = await openThread(page, songs[3].id, review)
  const replies = scope.getByRole('list', { name: /Replies to Toji/ })
  await expect(replies.locator('[data-comment-id]')).toHaveCount(2)
  await replies.getByRole('button', { name: 'View 1 more reply' }).click()
  await expect(replies.locator('[data-comment-id]')).toHaveCount(3)
  await expect(replies.getByRole('link', { name: `@${truly.username}` })).toBeVisible()
  await replies.getByRole('button', { name: 'Hide replies' }).click()
  await expect(replies.locator('[data-comment-id]')).toHaveCount(2)

  // Deeper than one level is refused by the database, whatever the app sends.
  const deep = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/review_comments`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ory.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ review_id: review, user_id: ory.id, body: 'too deep', parent_id: r1.id }),
  })
  expect(deep.status).toBe(400)
})

test('deleting: with replies it leaves "Comment deleted"; without, it disappears; counts include replies', async ({ page }) => {
  const review = await createReview(author.id, songs[4].id, 4, 'Delete test.')
  await adminFetch(`/rest/v1/review_comments?review_id=eq.${review}`, { method: 'DELETE' })
  const doomed = await commentAs(toji.token, review, toji.id, 'hot take incoming')
  await commentAs(truly.token, review, truly.id, 'go on then', doomed.id)
  await commentAs(toji.token, review, toji.id, 'a lonely comment')

  await login(page, toji.email)
  let scope = await openThread(page, songs[4].id, review)
  const card = page.locator(`article[data-review-id="${review}"]`)
  await expect(card.getByRole('button', { name: '3 comments' })).toBeVisible()

  for (const text of ['hot take incoming', 'a lonely comment']) {
    const row = commentRow(scope, text)
    await row.getByRole('button', { name: /^Delete your comment/ }).click()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(scope.getByText(text)).toHaveCount(0)
  }
  await expect(scope.getByText('Comment deleted')).toBeVisible()
  await expect(scope.getByText('go on then')).toBeVisible()
  scope = await openThread(page, songs[4].id, review)
  await expect(card.getByRole('button', { name: '1 comment' })).toBeVisible()
})

test('mention suggestions: thread first, then you follow, then follows you; arrows and Enter pick; no match says so', async ({ page }) => {
  const followed = await person('cvtrul', 'truly')
  const follower = await person('cvtrac', 'Tracy')
  await makeFollow(author.id, followed.id)
  await makeFollow(follower.id, author.id)
  const review = await createReview(author.id, songs[5].id, 5, 'Suggestions test.')
  await adminFetch(`/rest/v1/review_comments?review_id=eq.${review}`, { method: 'DELETE' })
  await commentAs(truly.token, review, truly.id, 'in the thread')

  await login(page, author.email)
  const scope = await openThread(page, songs[5].id, review)
  const box = scope.getByRole('combobox', { name: 'Add a comment' })
  await box.click()
  await box.pressSequentially('nice @cvtr')
  const list = page.getByRole('listbox', { name: 'Mention someone' })
  const options = list.getByRole('option')
  await expect(options.nth(0)).toContainText('In this thread')
  await expect(options.nth(0)).toContainText(`@${truly.username}`)
  await expect(options.nth(1)).toContainText('You follow')
  await expect(options.nth(2)).toContainText('Follows you')

  // Down twice, Enter: Tracy.
  await box.press('ArrowDown')
  await box.press('ArrowDown')
  await box.press('Enter')
  await expect(box).toHaveValue(`nice @${follower.username} `)

  await box.pressSequentially(`@zzq${tag}`)
  await expect(page.getByText('No one matches')).toBeVisible()
})

test('a reply that also mentions you is one notification; thread replies at most once an hour', async () => {
  const review = await createReview(author.id, songs[6].id, 5, 'Notification test.')
  const top = await commentAs(toji.token, review, toji.id, 'top comment by toji')
  for (const u of [author, toji, truly, ory]) await adminFetch(`/rest/v1/notifications?user_id=eq.${u.id}`, { method: 'DELETE' })

  await commentAs(truly.token, review, truly.id, `@${toji.username} replying and mentioning you`, top.id)
  const tojiTypes = (await notificationsOf(toji.id)).map((n) => n.type)
  expect(tojiTypes).toEqual(['comment_reply'])

  // ory replies twice; truly is in the thread and hears once.
  await commentAs(ory.token, review, ory.id, 'first from ory', top.id)
  await commentAs(ory.token, review, ory.id, 'second from ory', top.id)
  const trulyThread = (await notificationsOf(truly.id)).filter((n) => n.type === 'thread_reply')
  expect(trulyThread).toHaveLength(1)

  // Nobody is told about their own comment.
  expect((await notificationsOf(ory.id)).length).toBe(0)
})

test('notifications: badges, quote, filters with counts, an empty filter, and Reply opens the comment ready to answer', async ({ page }) => {
  const review = await createReview(author.id, songs[7].id, 5, 'Notifications page test.')
  const mine = await commentAs(author.token, review, author.id, 'my own take on it')
  for (const u of [author]) await adminFetch(`/rest/v1/notifications?user_id=eq.${u.id}`, { method: 'DELETE' })
  const reply = await commentAs(truly.token, review, truly.id, 'Wordddd wallah', mine.id)
  await commentAs(toji.token, review, toji.id, `@${author.username} you have to hear this`)
  for (const u of [toji, ory]) await likeCommentAs(u.token, mine.id, u.id)

  await login(page, author.email)
  await page.goto('/notifications')
  const replyRow = page.locator('li[data-notification-type="comment_reply"]').first()
  await expect(replyRow).toContainText('TrulyMe replied to your comment')
  await expect(replyRow).toContainText('Wordddd wallah')
  // The purple reply badge on the avatar (decorative for screen readers:
  // the sentence says it).
  await expect(replyRow.locator('[role="img"][aria-label="Reply"]')).toBeVisible()
  await expect(page.locator('li[data-notification-type="mention"]').first()).toContainText('mentioned you in a comment')
  // Two likes on one comment: one row.
  const likes = page.locator('li[data-notification-type="comment_liked"]')
  await expect(likes).toHaveCount(1)
  await expect(likes).toContainText('and 1 other liked your comment')

  await expect(page.getByRole('button', { name: /^Mentions/ })).toContainText('1')
  await page.getByRole('button', { name: /^Likes/ }).click()
  await expect(page.locator('li[data-notification-type]')).toHaveCount(1)
  await page.getByRole('button', { name: /^Artists/ }).click()
  await expect(page.getByText('No artists yet')).toBeVisible()
  await page.getByRole('button', { name: /^All/ }).click()

  // Like right from the notification.
  await replyRow.getByRole('button', { name: 'Like this comment' }).click()
  await expect(replyRow.getByRole('button', { name: 'Unlike this comment' })).toBeVisible()

  // Reply opens the review, the comment highlighted, the box ready.
  await replyRow.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.waitForURL(/reply=1/)
  await expect(page.locator(`[data-comment-id="${reply.id}"][data-highlighted="true"]`)).toBeVisible()
  await expect(page.getByRole('combobox', { name: `Reply to @${truly.username}` })).toBeFocused()
})

test('Arabic comments sit in their bubble under the name, not at the far side of the card', async ({ page }) => {
  const review = await createReview(author.id, songs[8].id, 5, 'مين انا عشان اقيم اغانيهم')
  await adminFetch(`/rest/v1/review_comments?review_id=eq.${review}`, { method: 'DELETE' })
  await commentAs(toji.token, review, toji.id, 'الملكه')

  await login(page, author.email)
  const scope = await openThread(page, songs[8].id, review)
  const row = commentRow(scope, 'الملكه')
  const name = await row.getByRole('link', { name: 'Toji' }).boundingBox()
  const text = await row.locator('p[dir="auto"]').boundingBox()
  expect(name && text).toBeTruthy()
  // The bubble starts where the name starts and is only as wide as the word.
  expect(Math.abs(text!.x - name!.x)).toBeLessThan(24)
  const rowBox = await row.boundingBox()
  expect(text!.width).toBeLessThan(rowBox!.width / 2)
})

test('privacy: logged out sees comments on public reviews only; a pending request is still an outsider', async ({ page }) => {
  const priv = await person('cvpriv', 'Private')
  const pending = await person('cvpend', 'Pending')
  await setPrivate(priv.id, true)
  await makeFollow(pending.id, priv.id, 'pending')

  const publicReview = await createReview(author.id, songs[9].id, 4, 'Public review.')
  const privateReview = await createReview(priv.id, songs[9].id, 4, 'Private review.')
  await commentAs(toji.token, publicReview, toji.id, 'public comment')
  await commentAs(priv.token, privateReview, priv.id, `private comment @${pending.username}`)
  await likeCommentAs(toji.token, (await commentAs(toji.token, publicReview, toji.id, 'likeable')).id, toji.id)

  expect(await readLoggedOut(`review_comments?review_id=eq.${publicReview}&select=id`)).not.toHaveLength(0)
  expect(await readLoggedOut(`review_likes?review_id=eq.${privateReview}&select=review_id`)).toHaveLength(0)
  expect(await readLoggedOut(`review_comments?review_id=eq.${privateReview}&select=id`)).toHaveLength(0)

  // The pending follower: no read, no mention, no notification.
  const asPending = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/review_comments?review_id=eq.${privateReview}&select=id,body`,
    { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${pending.token}` } }
  ).then((r) => r.json() as Promise<unknown[]>)
  expect(asPending).toHaveLength(0)
  const stored = (await (
    await adminFetch(`/rest/v1/review_comments?review_id=eq.${privateReview}&select=body`)
  ).json()) as { body: string }[]
  expect(stored[0].body).toContain(`@${pending.username}`)
  expect(stored[0].body).not.toContain(pending.id)
  expect((await notificationsOf(pending.id)).filter((n) => n.type === 'mention')).toHaveLength(0)

  // In the app, the private review isn't there for them at all.
  await login(page, pending.email)
  await page.goto(`/song/${songs[9].id}`)
  await expect(page.locator(`article[data-review-id="${privateReview}"]`)).toHaveCount(0)
})
