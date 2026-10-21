import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { getWeeklySong, type WeeklySong } from './mood'
import { weekTimer } from './weekTimer'

/**
 * Home's song of the week: the week, a clock that ticks every minute (the
 * record's timer), and whether it's folded into the tab row.
 *
 * Folded when the person folded it this week (remembered on this device,
 * per account, until the week changes) or has already rated the song.
 * When the week ends while the app is open, the next one is fetched.
 */

const TICK_MS = 60_000
const foldKey = (userId: string) => `beatboxed:sotw-folded:${userId}`

function readFold(userId: string) {
  try {
    return localStorage.getItem(foldKey(userId))
  } catch {
    return null
  }
}

function writeFold(userId: string, weekStart: string | null) {
  try {
    if (weekStart) localStorage.setItem(foldKey(userId), weekStart)
    else localStorage.removeItem(foldKey(userId))
  } catch {
    // Storage blocked: it just won't be remembered.
  }
}

export function useSongOfTheWeek() {
  const userId = useAuth().user?.id ?? null
  /** undefined while loading; null when there's no song this week. */
  const [week, setWeek] = useState<WeeklySong | null | undefined>(undefined)
  const [folded, setFolded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const reloadedFor = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const w = await getWeeklySong()
      setWeek(w)
      setNow(Date.now())
      if (w && userId) setFolded(w.myRating !== null || readFold(userId) === w.weekStart)
    } catch (err) {
      console.warn('[beatboxed] song of the week failed:', err)
      setWeek(null)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  const timer = week ? weekTimer(week.endsAt, now) : null

  // The week ran out while the app was open: on to the next one, once.
  useEffect(() => {
    if (!week || !timer?.over || reloadedFor.current === week.endsAt) return
    reloadedFor.current = week.endsAt
    void load()
  }, [week, timer?.over, load])

  const fold = useCallback(() => {
    setFolded(true)
    if (userId && week) writeFold(userId, week.weekStart)
  }, [userId, week])

  const unfold = useCallback(() => {
    setFolded(false)
    if (userId) writeFold(userId, null)
  }, [userId])

  return { week, timer, folded, fold, unfold }
}
