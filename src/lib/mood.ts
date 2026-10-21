import { supabase } from './supabase'

/**
 * The daily mood check-in (#9) and the song of the week (#10), as the app
 * sees them. Picking and choosing happen in the database
 * (pick_checkin_song, current_weekly_song, weekly_song_page in 0048); this
 * file only asks and shapes the answers.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/* ------------------------------------------------------------ check-in */

export type Feeling = 'happy' | 'sad' | 'calm' | 'stressed' | 'energetic' | 'nostalgic'
export type Goal = 'match' | 'lift' | 'calm' | 'focus'
export type Beat = 'slow' | 'between' | 'upbeat'
export type Familiar = 'known' | 'surprise'

export type CheckinAnswers = { feeling: Feeling; goal: Goal; beat: Beat; familiar: Familiar }

export const QUESTIONS = [
  {
    key: 'feeling',
    title: 'How are you feeling?',
    options: [
      { value: 'happy', label: 'Happy' },
      { value: 'sad', label: 'Sad' },
      { value: 'calm', label: 'Calm' },
      { value: 'stressed', label: 'Stressed' },
      { value: 'energetic', label: 'Energetic' },
      { value: 'nostalgic', label: 'Nostalgic' },
    ],
  },
  {
    key: 'goal',
    title: 'What should the music do?',
    options: [
      { value: 'match', label: 'Match how I feel' },
      { value: 'lift', label: 'Lift me up' },
      { value: 'calm', label: 'Calm me down' },
      { value: 'focus', label: 'Help me focus' },
    ],
  },
  {
    key: 'beat',
    title: 'What kind of beat?',
    options: [
      { value: 'slow', label: 'Slow and soft' },
      { value: 'between', label: 'Somewhere in between' },
      { value: 'upbeat', label: 'Upbeat' },
    ],
  },
  {
    key: 'familiar',
    title: 'Something you know, or something new?',
    options: [
      { value: 'known', label: 'Artists I already love' },
      { value: 'surprise', label: 'Surprise me' },
    ],
  },
] as const

export type CheckinPick = {
  songId: string
  title: string
  artistId: string | null
  artistName: string
  coverUrl: string | null
  lyricsMood: 'sad' | 'happy' | 'nostalgic' | 'romantic' | 'angry' | 'none'
  energy: 'low' | 'mid' | 'high'
  /** 0 an exact match; 1–3 the answers were loosened to find it. */
  relaxed: number
  followed: boolean
  likedArtist: boolean
  genreMatch: boolean
  newToYou: boolean
  similarAvg: number | null
  similarCount: number
}

export type TodayCheckin = {
  status: 'done' | 'skipped'
  answers: CheckinAnswers | null
  /** Songs shown today, the last one being the current pick. */
  shown: string[]
}

/** Today by the person's own clock, as YYYY-MM-DD. */
export function localDay(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function getTodayCheckin(userId: string): Promise<TodayCheckin | null> {
  const { data, error } = await requireClient()
    .from('mood_checkins')
    .select('status, answers, shown')
    .eq('user_id', userId)
    .eq('local_date', localDay())
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { status: 'done' | 'skipped'; answers: CheckinAnswers | null; shown: string[] | null }
  return { status: row.status, answers: row.answers, shown: row.shown ?? [] }
}

/** "Not today" and "Skip for today". */
export async function skipCheckin() {
  const { error } = await requireClient().rpc('skip_checkin', { local_day: localDay() })
  if (error) throw error
}

type PickRow = {
  song_id: string
  title: string
  artist_id: string | null
  artist_name: string | null
  cover_url: string | null
  lyrics_mood: CheckinPick['lyricsMood']
  energy: CheckinPick['energy']
  relaxed: number
  followed: boolean
  liked_artist: boolean
  genre_match: boolean
  new_to_you: boolean
  similar_avg: number | null
  similar_count: number
}

/** The pick, or null when nothing fits even after loosening the answers. */
export async function pickSong(answers: CheckinAnswers, another = false): Promise<CheckinPick | null> {
  const { data, error } = await requireClient().rpc('pick_checkin_song', {
    local_day: localDay(),
    answers,
    another,
  })
  if (error) throw error
  const row = ((data ?? []) as PickRow[])[0]
  if (!row) return null
  return {
    songId: row.song_id,
    title: row.title,
    artistId: row.artist_id,
    artistName: row.artist_name ?? 'Unknown artist',
    coverUrl: row.cover_url,
    lyricsMood: row.lyrics_mood,
    energy: row.energy,
    relaxed: row.relaxed,
    followed: row.followed,
    likedArtist: row.liked_artist,
    genreMatch: row.genre_match,
    newToYou: row.new_to_you,
    similarAvg: row.similar_avg === null ? null : Number(row.similar_avg),
    similarCount: row.similar_count,
  }
}

const MOOD_WORD: Record<CheckinPick['lyricsMood'], string> = {
  sad: 'Sad',
  happy: 'Happy',
  nostalgic: 'Nostalgic',
  romantic: 'Romantic',
  angry: 'Angry',
  none: 'No',
}

const ENERGY_TAG: Record<CheckinPick['energy'], string> = {
  low: 'Slow beat',
  mid: 'Mid-tempo',
  high: 'Upbeat',
}

/** The tags under the song: mood, beat, and why it's yours. */
export function pickTags(p: CheckinPick): string[] {
  const tags = [p.lyricsMood === 'none' ? 'Instrumental' : `${MOOD_WORD[p.lyricsMood]} lyrics`, ENERGY_TAG[p.energy]]
  if (p.followed) tags.push('Artist you follow')
  else if (p.newToYou) tags.push('New to you')
  return tags
}

/**
 * "Why this one": fixed templates, filled from what the database says about
 * the pick. Never generated text.
 */
export function whyThisOne(p: CheckinPick, answers: CheckinAnswers): string {
  const moodPhrase = p.lyricsMood === 'none' ? 'No lyrics' : `${MOOD_WORD[p.lyricsMood]} lyrics`
  const beatPhrase = { low: 'a slow beat', mid: 'a mid-tempo beat', high: 'an upbeat beat' }[p.energy]
  const first =
    p.relaxed === 0
      ? `${moodPhrase} with ${beatPhrase}, just what you asked for.`
      : `${moodPhrase} with ${beatPhrase}, close to what you asked for.`
  let second = ''
  if (p.similarAvg !== null && p.similarCount > 0) {
    second = ` People with your taste rate it ${p.similarAvg.toFixed(1)} on average.`
  } else if (p.followed) {
    second = ' It’s by an artist you follow.'
  } else if (p.likedArtist) {
    second = ' You’ve liked this artist before.'
  } else if (answers.familiar === 'surprise' && p.newToYou) {
    second = p.genreMatch ? ' Someone new, in a genre you like.' : ' Someone new for you.'
  } else if (p.genreMatch) {
    second = ' It fits the genres you picked.'
  }
  return first + second
}

/* ------------------------------------------------------ song of the week */

export type WeeklyPerson = { id: string; username: string | null; displayName: string | null; avatarUrl: string | null }

export type WeeklyReview = {
  id: string
  userId: string
  rating: number
  title: string | null
  body: string
  person: WeeklyPerson
}

export type WeeklySong = {
  weekStart: string
  weekEnd: string
  /** The exact moments the week starts and ends (Saudi midnight), from the database. */
  startsAt: string
  endsAt: string
  reason: 'most_rated' | 'trending'
  song: { id: string; title: string; artistId: string | null; artistName: string; coverUrl: string | null }
  myRating: number | null
  average: number | null
  ratings: number
  distribution: Record<1 | 2 | 3 | 4 | 5, number>
  followedRaters: WeeklyPerson[]
  followedRaterCount: number
  topReviews: WeeklyReview[]
  matchesTaste: boolean
  pastWeeks: {
    weekStart: string
    weekEnd: string
    songId: string
    title: string
    artistName: string | null
    coverUrl: string | null
    average: number | null
  }[]
}

type PersonJson = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }
const person = (p: PersonJson): WeeklyPerson => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
  avatarUrl: p.avatar_url,
})

/**
 * This week's song with everything the card and page show, choosing it
 * first when this is the week's first visit. Null when the catalogue is
 * empty (nothing to choose).
 */
export async function getWeeklySong(weekStart?: string): Promise<WeeklySong | null> {
  const { data, error } = await requireClient().rpc('weekly_song_page', weekStart ? { target_week: weekStart } : {})
  if (error) throw error
  if (!data) return null
  const d = data as {
    week_start: string
    week_end: string
    starts_at: string
    ends_at: string
    reason: WeeklySong['reason']
    song: { id: string; title: string; artist_id: string | null; artist_name: string | null; cover_url: string | null }
    my_rating: number | null
    average: number | null
    ratings: number
    distribution: Record<string, number> | null
    followed_raters: PersonJson[] | null
    followed_rater_count: number
    top_reviews: (PersonJson & { user_id: string; rating: number; body: string; title: string | null })[] | null
    matches_taste: boolean | null
    past_weeks:
      | { week_start: string; week_end: string; song_id: string; title: string; artist_name: string | null; cover_url: string | null; average: number | null }[]
      | null
  }
  const dist = d.distribution ?? {}
  return {
    weekStart: d.week_start,
    weekEnd: d.week_end,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    reason: d.reason,
    song: {
      id: d.song.id,
      title: d.song.title,
      artistId: d.song.artist_id,
      artistName: d.song.artist_name ?? 'Unknown artist',
      coverUrl: d.song.cover_url,
    },
    myRating: d.my_rating,
    average: d.average === null ? null : Number(d.average),
    ratings: Number(d.ratings ?? 0),
    distribution: {
      1: dist['1'] ?? 0,
      2: dist['2'] ?? 0,
      3: dist['3'] ?? 0,
      4: dist['4'] ?? 0,
      5: dist['5'] ?? 0,
    },
    followedRaters: (d.followed_raters ?? []).map(person),
    followedRaterCount: Number(d.followed_rater_count ?? 0),
    topReviews: (d.top_reviews ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      person: person({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url }),
    })),
    matchesTaste: Boolean(d.matches_taste),
    pastWeeks: (d.past_weeks ?? []).map((w) => ({
      weekStart: w.week_start,
      weekEnd: w.week_end,
      songId: w.song_id,
      title: w.title,
      artistName: w.artist_name,
      coverUrl: w.cover_url,
      average: w.average === null ? null : Number(w.average),
    })),
  }
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' })
/** "Oct 13–19", or "Sep 29–Oct 5" across months. */
export function weekRange(start: string, end: string) {
  const s = new Date(`${start}T12:00:00Z`)
  const e = new Date(`${end}T12:00:00Z`)
  const sm = MONTH.format(s)
  const em = MONTH.format(e)
  return sm === em ? `${sm} ${s.getUTCDate()}–${e.getUTCDate()}` : `${sm} ${s.getUTCDate()}–${em} ${e.getUTCDate()}`
}

/**
 * A star tap on the weekly page: changes only the rating. An existing
 * review keeps its title and text (the composer's save would clear them).
 */
export async function setMyRating(songId: string, userId: string, rating: number) {
  const client = requireClient()
  const { data, error } = await client
    .from('reviews')
    .update({ rating })
    .eq('song_id', songId)
    .eq('user_id', userId)
    .select('id')
  if (error) throw error
  if ((data ?? []).length > 0) return
  const { error: insertError } = await client.from('reviews').insert({ song_id: songId, user_id: userId, rating })
  if (insertError) throw insertError
}
