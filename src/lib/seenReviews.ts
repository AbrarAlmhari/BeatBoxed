/**
 * Reviews this device has scrolled past in For You, so the next visit can
 * sink them a little (migration 0055's seen_ids). Kept in this browser only,
 * per account: nothing about it is sent anywhere except as that one list.
 *
 * Light by design: the newest 300 for 14 days, writes batched a few seconds
 * apart (and when the page is hidden), and every storage call guarded, so a
 * private window or blocked storage just means nothing sinks.
 */

const MAX = 300
const KEEP_MS = 14 * 24 * 3600 * 1000
const FLUSH_MS = 3000

type Store = Record<string, number>

const keyFor = (userId: string) => `beatboxed:seen-reviews:${userId}`

function read(userId: string): Store {
  try {
    const raw = window.localStorage.getItem(keyFor(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

/** The newest MAX entries still within KEEP_MS. */
function prune(store: Store, now: number): Store {
  const kept = Object.entries(store)
    .filter(([, at]) => typeof at === 'number' && now - at < KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX)
  return Object.fromEntries(kept)
}

/** The ids to sink in a new For You session, newest first. */
export function readSeenReviews(userId: string): string[] {
  return Object.keys(prune(read(userId), Date.now()))
}

const pending = new Map<string, Set<string>>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  timer = null
  const now = Date.now()
  for (const [userId, ids] of pending) {
    const store = read(userId)
    for (const id of ids) store[id] = now
    try {
      window.localStorage.setItem(keyFor(userId), JSON.stringify(prune(store, now)))
    } catch {
      // Storage full or blocked: this visit's list is simply not kept.
    }
  }
  pending.clear()
}

let listening = false
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  // Don't lose the last few seconds when the tab is closed or hidden.
  const now = () => {
    if (pending.size) flush()
  }
  window.addEventListener('pagehide', now)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') now()
  })
}

/** Notes reviews as scrolled past; saved together a few seconds later. */
export function markReviewsSeen(userId: string, ids: string[]) {
  if (!ids.length) return
  listen()
  const set = pending.get(userId) ?? new Set<string>()
  for (const id of ids) set.add(id)
  pending.set(userId, set)
  timer ??= setTimeout(flush, FLUSH_MS)
}
