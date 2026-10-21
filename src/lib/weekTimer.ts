/**
 * The song of the week's countdown. A week runs Sunday 00:00 to Saturday
 * 23:59, Saudi time; the database works out its exact end (ends_at from
 * weekly_song_page, see riyadh_week_bounds in 0049), and everything here
 * counts down to that moment.
 */

export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS
const HOUR_MS = 3_600_000

/** Saudi Arabia is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * HOUR_MS

/** Days since 1970 of the calendar day a moment falls on, in Saudi time. */
function riyadhDay(ms: number) {
  return Math.floor((ms + RIYADH_OFFSET_MS) / DAY_MS)
}

export type WeekTimer = {
  /** Time left ÷ 7 days, 0 to 1. The short changeover week starts at 6/7. */
  shareLeft: number
  /** Saturday, Saudi time: the record spins. */
  lastDay: boolean
  /** "4 days left", "last day", "3 hours left", "less than an hour left". */
  label: string
  /** The pie's colour: green when full, through yellow and orange, to red. */
  color: string
  /** The pie's drawn share: never below 3%, so a thin red line is left. */
  drawnShare: number
  over: boolean
}

export function weekTimer(endsAt: string, now = Date.now()): WeekTimer {
  const end = Date.parse(endsAt)
  const left = Math.max(0, end - now)
  const shareLeft = Math.min(1, left / WEEK_MS)
  // Calendar days left, counting today: Sunday is 7, Saturday is 1.
  const daysLeft = riyadhDay(end - 1) - riyadhDay(now) + 1
  const lastDay = left > 0 && daysLeft <= 1

  let label: string
  if (daysLeft >= 2) label = `${daysLeft} days left`
  else if (left > 6 * HOUR_MS) label = 'last day'
  else if (left > HOUR_MS) label = `${Math.ceil(left / HOUR_MS)} hours left`
  else label = 'less than an hour left'

  return {
    shareLeft,
    lastDay,
    label,
    color: `hsl(${Math.round(130 * shareLeft)} 72% ${lastDay ? 55 : 48}%)`,
    drawnShare: Math.max(shareLeft, 0.03),
    over: left === 0,
  }
}
