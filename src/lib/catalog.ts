import { supabase } from './supabase'
import { getNotificationPrefs } from './settings'
import type {
  ArtistCardModel,
  LyricMatch,
  LyricsResult,
  ReviewComment,
  ReviewWithAuthor,
  SearchMode,
  SearchResults,
  SongCardModel,
  SongDetail,
  ProfileDetail,
  ReviewWithSong,
  PersonCardModel,
  FriendState,
  FriendEdge,
  UnifiedResults,
  NotificationRow,
  Announcement,
  UpdateItem,
  NotificationCenter,
} from './types'

/**
 * Every read the Home and Explore screens make. Replaces the old mockData.ts —
 * catalog rows are cached into our own tables by the spotify-search Edge
 * Function, so the UI only ever sees our schema, never Spotify's payload.
 */

/**
 * PostgREST returns a single object for a many-to-one embed, but supabase-js
 * types it as an array. Accept both and normalise with one().
 */
type Rel<T> = T | T[] | null
const one = <T,>(v: Rel<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

type SongRow = {
  id: string
  title: string
  genre: string | null
  artist_id: string
  artists: Rel<{ name: string }>
  albums: Rel<{ cover_url: string | null }>
}

const SONG_SELECT = 'id, title, genre, artist_id, artists(name), albums(cover_url)'

function toCardModel(
  row: SongRow,
  stats?: { avg: number | null; count: number }
): SongCardModel {
  return {
    id: row.id,
    title: row.title,
    artistName: one(row.artists)?.name ?? 'Unknown artist',
    coverUrl: one(row.albums)?.cover_url ?? null,
    ratingAvg: stats?.avg ?? null,
    reviewCount: stats?.count ?? 0,
  }
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/**
 * Review aggregates for a set of songs.
 *
 * Read through song_rating_stats(), a security definer function that returns
 * only the average and the count. It used to fetch raw review rows and
 * average them here, which stopped being correct once account privacy landed
 * in 0022: a private user's reviews are hidden from everyone but their
 * friends, so a client-side average would silently drop them from every
 * song's score. Their ratings still count — anonymously — and no caller ever
 * receives the rows behind the number.
 *
 * This is the aggregate behind every song card in the app, via decorate().
 */
async function ratingsFor(songIds: string[]) {
  const stats = new Map<string, { avg: number | null; count: number }>()
  if (songIds.length === 0) return stats

  const { data, error } = await requireClient().rpc('song_rating_stats', {
    song_ids: songIds,
  })

  if (error) {
    // pre-0022: fall back to the old client-side aggregate so a checkout
    // ahead of the database still renders. Delete once 0022 is applied.
    if (error.code === 'PGRST202') return ratingsForClientSide(songIds)
    throw error
  }

  for (const row of (data ?? []) as {
    song_id: string
    rating_avg: number | string | null
    review_count: number | string
  }[]) {
    stats.set(row.song_id, {
      // numeric comes back as a string from PostgREST.
      avg: row.rating_avg == null ? null : Number(row.rating_avg),
      count: Number(row.review_count),
    })
  }
  return stats
}

/** The pre-0022 path. Only reachable when song_rating_stats() is missing. */
async function ratingsForClientSide(songIds: string[]) {
  const stats = new Map<string, { avg: number | null; count: number }>()
  const { data, error } = await requireClient()
    .from('reviews')
    .select('song_id, rating')
    .in('song_id', songIds)
  if (error) throw error

  const buckets = new Map<string, number[]>()
  for (const r of data ?? []) {
    const list = buckets.get(r.song_id) ?? []
    list.push(r.rating)
    buckets.set(r.song_id, list)
  }
  for (const [songId, ratings] of buckets) {
    stats.set(songId, {
      avg: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      count: ratings.length,
    })
  }
  return stats
}

async function decorate(rows: SongRow[]): Promise<SongCardModel[]> {
  const stats = await ratingsFor(rows.map((r) => r.id))
  return rows.map((r) => toCardModel(r, stats.get(r.id)))
}

/**
 * A card plus where to pick it back up. The resume point rides along with the
 * card so tapping play needs no second lookup.
 */
export type ContinueSong = SongCardModel & { resumeAt: number }

export type HomeFeed = {
  continueListening: ContinueSong[]
  trending: SongCardModel[]
  forYou: SongCardModel[]
}

/**
 * Trending: most popular of what we've cached.
 *
 * `popularity` is Deezer's rank, stored at cache time — Spotify withholds its
 * own popularity figure from this app and blocks every chart endpoint. Rows
 * Deezer couldn't match keep null and sort last, falling back to recency.
 *
 * This ranks only songs already in our cache, so it's "most popular of what
 * Beatboxed knows about", not a global chart. Review counts and averages are
 * unchanged elsewhere; they just no longer drive this rail.
 */
async function fetchTrending(limit = 12): Promise<SongCardModel[]> {
  const { data, error } = await requireClient()
    .from('songs')
    .select(SONG_SELECT)
    .order('popularity', { ascending: false, nullsFirst: false })
    .order('cached_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  return decorate((data ?? []) as unknown as SongRow[])
}

/** Records that this user opened a song. Best-effort: never blocks the page. */
export async function recordSongView(songId: string, userId: string) {
  const { error } = await requireClient()
    .from('song_views')
    .upsert(
      { user_id: userId, song_id: songId, viewed_at: new Date().toISOString() },
      { onConflict: 'user_id,song_id' }
    )
  if (error) console.warn('[beatboxed] could not record song view:', error.message)
}

/**
 * Marks a song as actually listened to. Called once per song per session,
 * after the play passes the "this wasn't a skip" bar the player enforces.
 *
 * Upsert, so replaying moves the timestamp rather than adding a row.
 * Best-effort: a failure here must never interrupt playback.
 */
export async function recordPlay(
  userId: string,
  songId: string,
  positionSeconds: number
) {
  const { error } = await requireClient().from('play_history').upsert(
    {
      user_id: userId,
      song_id: songId,
      played_at: new Date().toISOString(),
      position_seconds: Math.max(0, positionSeconds),
    },
    { onConflict: 'user_id,song_id' }
  )
  if (error) console.warn('[beatboxed] could not record play:', error.message)
}

/**
 * Moves the resume point without touching played_at — pausing isn't a new
 * play, and bumping the timestamp would reshuffle the rail every time the
 * user hit pause. Update rather than upsert: a row exists only once the play
 * cleared the minimum, so a 2-second skip can't create one through this path.
 */
export async function savePlayPosition(
  userId: string,
  songId: string,
  positionSeconds: number
) {
  const { error } = await requireClient()
    .from('play_history')
    .update({ position_seconds: Math.max(0, positionSeconds) })
    .eq('user_id', userId)
    .eq('song_id', songId)
  if (error) console.warn('[beatboxed] could not save position:', error.message)
}

/**
 * Continue Listening: the songs this user actually played, newest first.
 *
 * The primary key already makes a song unique per user, but the catalog has
 * genuine duplicate rows for the same recording (19 of them at last count),
 * so the same title by the same artist is collapsed to its most recent row.
 * That means over-fetching and trimming afterwards.
 */
export async function getContinueListening(
  userId: string,
  limit = 10
): Promise<ContinueSong[]> {
  const { data, error } = await requireClient()
    .from('play_history')
    .select(`played_at, position_seconds, songs(${SONG_SELECT})`)
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit * 4)
  if (error) throw error

  const rows = (data ?? []) as unknown as {
    played_at: string
    position_seconds: number | null
    songs: Rel<SongRow>
  }[]

  const seen = new Set<string>()
  const picked: { song: SongRow; resumeAt: number }[] = []
  for (const row of rows) {
    const song = one(row.songs)
    if (!song) continue
    const key = `${song.title.trim().toLowerCase()}|${
      one(song.artists)?.name.trim().toLowerCase() ?? ''
    }`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ song, resumeAt: row.position_seconds ?? 0 })
    if (picked.length >= limit) break
  }

  const stats = await ratingsFor(picked.map((p) => p.song.id))
  return picked.map((p) => ({
    ...toCardModel(p.song, stats.get(p.song.id)),
    resumeAt: p.resumeAt,
  }))
}

/**
 * For You: in-catalog affinity.
 *
 * Seeds are the songs this user has engaged with deliberately — reviewed, or
 * opened the detail page for — plus any artists they follow. From those we
 * take the artists and genres and surface *other* cached songs matching them,
 * ranked by popularity.
 *
 * Deliberately not using raw search queries: typing something and never
 * opening it is weak evidence of taste. A song view means they went past the
 * results list.
 *
 * Spotify's own similarity endpoints are all blocked for this app
 * (/recommendations 404, /related-artists and /audio-features 403), so this
 * matches within our own cache rather than asking anyone what "similar" means.
 */
async function fetchForYou(
  userId: string,
  limit = 12
): Promise<SongCardModel[]> {
  const client = requireClient()

  const [reviewed, viewed, follows] = await Promise.all([
    client.from('reviews').select('song_id').eq('user_id', userId),
    client
      .from('song_views')
      .select('song_id')
      .eq('user_id', userId)
      .order('viewed_at', { ascending: false })
      .limit(40),
    client.from('follows').select('artist_id').eq('user_id', userId),
  ])
  if (reviewed.error) throw reviewed.error
  if (viewed.error) throw viewed.error
  if (follows.error) throw follows.error

  const seedSongIds = [
    ...new Set([
      ...(reviewed.data ?? []).map((r) => r.song_id),
      ...(viewed.data ?? []).map((v) => v.song_id),
    ]),
  ]
  const followedArtistIds = (follows.data ?? []).map((f) => f.artist_id)

  if (seedSongIds.length === 0 && followedArtistIds.length === 0) return []

  // What those seed songs are made of: which artists, which genres.
  const seedArtistIds = new Set(followedArtistIds)
  const seedGenres = new Set<string>()
  if (seedSongIds.length > 0) {
    const { data: seeds, error } = await client
      .from('songs')
      .select('artist_id, genre')
      .in('id', seedSongIds)
    if (error) throw error
    for (const row of seeds ?? []) {
      if (row.artist_id) seedArtistIds.add(row.artist_id)
      if (row.genre) seedGenres.add(row.genre)
    }
  }
  if (seedArtistIds.size === 0 && seedGenres.size === 0) return []

  // Same artist first, then same genre — a second track by an artist you
  // reviewed is a safer recommendation than any song sharing its genre.
  const byArtist = seedArtistIds.size
    ? await client
        .from('songs')
        .select(SONG_SELECT)
        .in('artist_id', [...seedArtistIds])
        .order('popularity', { ascending: false, nullsFirst: false })
        .limit(limit * 3)
    : { data: [], error: null }
  if (byArtist.error) throw byArtist.error

  const byGenre = seedGenres.size
    ? await client
        .from('songs')
        .select(SONG_SELECT)
        .in('genre', [...seedGenres])
        .order('popularity', { ascending: false, nullsFirst: false })
        .limit(limit * 3)
    : { data: [], error: null }
  if (byGenre.error) throw byGenre.error

  const seen = new Set(seedSongIds) // don't recommend what they already know
  const perArtist = new Map<string, number>()
  const signatures = new Set<string>()
  const picked: SongRow[] = []

  /**
   * 74% of cached songs have no genre (user searches don't tag one), so
   * without a per-artist cap a single reviewed artist floods the whole rail
   * with their back catalogue. Three each keeps it recognisable but varied.
   */
  const MAX_PER_ARTIST = 3

  const consider = (row: SongRow) => {
    if (picked.length >= limit) return
    if (seen.has(row.id)) return

    // The catalog holds the same track under several Spotify ids (single vs
    // album release), which would otherwise show as visible duplicates.
    const signature = `${row.title.trim().toLowerCase()}|${row.artist_id}`
    if (signatures.has(signature)) return

    const count = perArtist.get(row.artist_id) ?? 0
    if (count >= MAX_PER_ARTIST) return

    seen.add(row.id)
    signatures.add(signature)
    perArtist.set(row.artist_id, count + 1)
    picked.push(row)
  }

  for (const row of (byArtist.data ?? []) as unknown as SongRow[]) consider(row)
  for (const row of (byGenre.data ?? []) as unknown as SongRow[]) consider(row)

  // Still thin — top up with popular songs they haven't seen, so the rail is
  // never half-empty just because their taste is narrow.
  if (picked.length < limit) {
    const { data: popular, error } = await client
      .from('songs')
      .select(SONG_SELECT)
      .order('popularity', { ascending: false, nullsFirst: false })
      .limit(limit * 4)
    if (error) throw error
    for (const row of (popular ?? []) as unknown as SongRow[]) consider(row)
  }

  return decorate(picked)
}

export async function getHomeFeedData(userId?: string): Promise<HomeFeed> {
  const trending = await fetchTrending()

  // The rail is a convenience, so it fails quietly: a problem reading play
  // history hides one row rather than replacing the whole page with an error.
  // That also keeps Home working on a checkout where 0018_play_history.sql
  // hasn't been applied yet.
  let continueListening: ContinueSong[] = []
  if (userId) {
    try {
      continueListening = await getContinueListening(userId)
    } catch (err) {
      console.warn('[beatboxed] could not load continue listening:', err)
    }
  }

  let forYou: SongCardModel[] = []
  if (userId) forYou = await fetchForYou(userId)

  // Nothing to personalise from yet — Trending is the honest fallback.
  if (forYou.length === 0) forYou = trending

  return { continueListening, trending, forYou }
}

/** Distinct genres actually present in the cached catalog. */
export async function getGenres(): Promise<string[]> {
  const { data, error } = await requireClient()
    .from('songs')
    .select('genre')
    .not('genre', 'is', null)
  if (error) throw error

  return [...new Set((data ?? []).map((r) => r.genre as string))].sort()
}

export const popularSearches = [
  'Radiohead',
  'dream pop',
  'Fairuz',
  'Tame Impala',
  'lo-fi',
  'Amr Diab',
]

/** Below this many local hits, reach out to Spotify and cache more. */
const REMOTE_TOPUP_THRESHOLD = 5

/** Same columns, but inner-joined so we can filter on the artist's name. */
const SONG_SELECT_BY_ARTIST =
  'id, title, genre, artist_id, artists!inner(name), albums(cover_url)'

/**
 * Matches the query against the song title OR the artist name.
 *
 * Title-only matching was the reason the Spotify top-up looked broken: a
 * search for "Radiohead" found no song *titled* Radiohead, triggered the
 * top-up, cached the songs, then re-queried by title and still found nothing.
 * PostgREST can't OR across a base column and an embedded one in a single
 * filter, so this is two queries merged by id.
 */
async function localSongs(query: string, genre: string | null) {
  const client = requireClient()

  const byTitleQuery = () => {
    let q = client.from('songs').select(SONG_SELECT).limit(40)
    if (genre) q = q.eq('genre', genre)
    return q
  }

  if (!query) {
    const { data, error } = await byTitleQuery()
    if (error) throw error
    return (data ?? []) as unknown as SongRow[]
  }

  const byArtistQuery = () => {
    let q = client.from('songs').select(SONG_SELECT_BY_ARTIST).limit(40)
    if (genre) q = q.eq('genre', genre)
    return q.ilike('artists.name', `%${query}%`)
  }

  const [titleRes, artistRes] = await Promise.all([
    byTitleQuery().ilike('title', `%${query}%`),
    byArtistQuery(),
  ])
  if (titleRes.error) throw titleRes.error
  if (artistRes.error) throw artistRes.error

  const merged = new Map<string, SongRow>()
  for (const row of [
    ...((titleRes.data ?? []) as unknown as SongRow[]),
    ...((artistRes.data ?? []) as unknown as SongRow[]),
  ]) {
    merged.set(row.id, row)
  }
  return [...merged.values()]
}

async function localArtists(query: string, genre: string | null) {
  let q = requireClient()
    .from('artists')
    .select('id, name, image_url, genres')
    .limit(40)
  if (genre) q = q.contains('genres', [genre])
  if (query) q = q.ilike('name', `%${query}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(
    (a): ArtistCardModel => ({
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      genres: a.genres ?? [],
    })
  )
}

type TopUpResult = { ok: boolean; message?: string }

/**
 * Fire the cache-fill Edge Function.
 *
 * supabase-js attaches the signed-in user's access token to functions.invoke
 * automatically, which is what spotify-search's JWT verification wants — no
 * manual Authorization header needed.
 *
 * Failures are non-fatal (local results still render) but must not be silent:
 * the message is returned so the UI can say the catalog top-up didn't happen.
 */
async function topUpFromSpotify(
  query: string,
  type: 'track' | 'artist'
): Promise<TopUpResult> {
  try {
    const { data, error } = await requireClient().functions.invoke(
      'spotify-search',
      { body: { q: query, type } }
    )
    if (error) {
      console.error('[beatboxed] spotify-search failed:', error)
      return { ok: false, message: "Couldn't reach Spotify for more results." }
    }
    // The function answers 200 with an { error } body for upstream problems.
    if (data?.error) {
      console.error('[beatboxed] spotify-search returned an error:', data.error)
      return { ok: false, message: `Spotify lookup failed: ${data.error}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[beatboxed] spotify-search unreachable:', err)
    return { ok: false, message: "Couldn't reach Spotify for more results." }
  }
}

/**
 * Local-first: query our cache, and only reach for Spotify when the cache is
 * thin. The single place search behaviour lives.
 */
export async function searchCatalog(
  query: string,
  mode: SearchMode,
  genre: string | null
): Promise<SearchResults> {
  const trimmed = query.trim()

  // Rows cached from a user search carry no genre (we don't guess one), so a
  // top-up can never satisfy an active genre filter — skip it and say why
  // rather than firing a request whose results are guaranteed to be hidden.
  const canTopUp = trimmed.length > 0 && genre === null
  const genreBlockedTopUp = trimmed.length > 0 && genre !== null
  let warning: string | undefined

  if (mode === 'artists') {
    let artists = await localArtists(trimmed, genre)
    if (canTopUp && artists.length < REMOTE_TOPUP_THRESHOLD) {
      const top = await topUpFromSpotify(trimmed, 'artist')
      if (top.ok) artists = await localArtists(trimmed, genre)
      else warning = top.message
    } else if (genreBlockedTopUp && artists.length < REMOTE_TOPUP_THRESHOLD) {
      warning = 'Showing cached results only. Clear the genre filter to search Spotify.'
    }
    return { mode: 'artists', artists, warning }
  }

  let rows = await localSongs(trimmed, genre)
  if (canTopUp && rows.length < REMOTE_TOPUP_THRESHOLD) {
    const top = await topUpFromSpotify(trimmed, 'track')
    if (top.ok) rows = await localSongs(trimmed, genre)
    else warning = top.message
  } else if (genreBlockedTopUp && rows.length < REMOTE_TOPUP_THRESHOLD) {
    warning = 'Showing cached results only. Clear the genre filter to search Spotify.'
  }

  if (mode === 'lyrics') {
    // lrclib matches a specific track, so lyrics search means: find candidate
    // songs, then ask lyrics-lookup for each and keep the lines that match.
    const lyrics: LyricMatch[] = []
    if (!trimmed) return { mode: 'lyrics', lyrics, warning }

    const client = requireClient()
    const candidates = rows.slice(0, 8)
    const lookups = await Promise.all(
      candidates.map(async (row) => {
        try {
          const { data } = await client.functions.invoke('lyrics-lookup', {
            body: { artist: one(row.artists)?.name ?? '', track: row.title },
          })
          return { row, data }
        } catch {
          return { row, data: null }
        }
      })
    )

    const needle = trimmed.toLowerCase()
    for (const { row, data } of lookups) {
      const plain: string | null = data?.plainLyrics ?? null
      if (!plain) continue
      for (const line of plain.split('\n')) {
        if (line.toLowerCase().includes(needle)) {
          lyrics.push({
            songId: row.id,
            songTitle: row.title,
            artistName: one(row.artists)?.name ?? 'Unknown artist',
            line: line.trim(),
          })
        }
      }
    }
    return { mode: 'lyrics', lyrics, warning }
  }

  return { mode: 'songs', songs: await decorate(rows), warning }
}

/* -------------------------------------------------------------- song detail */

type SongDetailRow = {
  id: string
  title: string
  genre: string | null
  duration_ms: number
  spotify_id: string | null
  artists: Rel<{ id: string; name: string; image_url: string | null }>
  albums: Rel<{
    id: string
    title: string
    cover_url: string | null
    release_date: string | null
  }>
}

/** Null when the id isn't in our cache — callers show a not-found state. */
export async function getSongDetail(id: string): Promise<SongDetail | null> {
  const { data, error } = await requireClient()
    .from('songs')
    .select(
      'id, title, genre, duration_ms, spotify_id, ' +
        'artists(id, name, image_url), ' +
        'albums(id, title, cover_url, release_date)'
    )
    .eq('id', id)
    .maybeSingle()

  // An invalid uuid makes Postgres raise rather than return empty; that's a
  // bad link, not a failure worth surfacing as an error.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  if (!data) return null

  const row = data as unknown as SongDetailRow
  const stats = (await ratingsFor([row.id])).get(row.id)
  const artist = one(row.artists)
  const album = one(row.albums)

  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    durationMs: row.duration_ms,
    spotifyId: row.spotify_id,
    artist: artist
      ? { id: artist.id, name: artist.name, imageUrl: artist.image_url }
      : null,
    album: album
      ? {
          id: album.id,
          title: album.title,
          coverUrl: album.cover_url,
          releaseDate: album.release_date,
        }
      : null,
    ratingAvg: stats?.avg ?? null,
    reviewCount: stats?.count ?? 0,
  }
}

type ReviewRow = {
  id: string
  user_id: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
  edited: boolean
  /** PostgREST aggregate embeds come back as [{ count: n }]. */
  review_likes?: { count: number }[]
  review_comments?: { count: number }[]
  profiles: Rel<{
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }>
}

// review_likes and review_comments both reference profiles, which gives
// reviews a second path to that table — PostgREST then rejects a bare
// `profiles(...)` embed as ambiguous (PGRST201). Name the FK to pin it.
const REVIEW_SELECT =
  'id, user_id, rating, title, body, created_at, edited, ' +
  'profiles!reviews_user_id_fkey(username, display_name, avatar_url), ' +
  'review_likes(count), review_comments(count)'

/**
 * One page of reviews, newest first, plus the true total.
 *
 * The page is partial, so the header's average must NOT be derived from it —
 * use getSongRatingStats() for that. Averaging a 10-row page would show the
 * wrong number as soon as a song has more reviews than fit on one page.
 */
export async function getSongReviews(
  songId: string,
  opts: { limit?: number; offset?: number; viewerId?: string } = {}
): Promise<{ reviews: ReviewWithAuthor[]; total: number }> {
  const limit = opts.limit ?? 10
  const offset = opts.offset ?? 0
  const client = requireClient()

  const { data, error, count } = await client
    .from('reviews')
    .select(REVIEW_SELECT, { count: 'exact' })
    .eq('song_id', songId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error

  const rows = (data ?? []) as unknown as ReviewRow[]

  // Which of these the viewer has liked. One extra query beats embedding a
  // filtered relation per row.
  let likedIds = new Set<string>()
  if (opts.viewerId && rows.length > 0) {
    const { data: likes, error: likeErr } = await client
      .from('review_likes')
      .select('review_id')
      .eq('user_id', opts.viewerId)
      .in('review_id', rows.map((r) => r.id))
    if (likeErr) throw likeErr
    likedIds = new Set((likes ?? []).map((l) => l.review_id))
  }

  const reviews = rows.map((r) => toReviewModel(r, likedIds.has(r.id)))
  return { reviews, total: count ?? reviews.length }
}

function toReviewModel(r: ReviewRow, likedByMe: boolean): ReviewWithAuthor {
  const p = one(r.profiles)
  return {
    id: r.id,
    userId: r.user_id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    edited: r.edited,
    likeCount: r.review_likes?.[0]?.count ?? 0,
    likedByMe,
    commentCount: r.review_comments?.[0]?.count ?? 0,
    author: p
      ? {
          username: p.username,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
        }
      : null,
  }
}

/** Authoritative rating summary for one song, computed server-side over all rows. */
export async function getSongRatingStats(songId: string) {
  const stats = (await ratingsFor([songId])).get(songId)
  return { ratingAvg: stats?.avg ?? null, reviewCount: stats?.count ?? 0 }
}

/** Strip LRC timestamps: "[00:12.34] line" -> "line". */
function parseLrc(synced: string): string[] {
  return synced
    .split('\n')
    .map((l) => l.replace(/^\s*(\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '').trim())
    .filter((l) => l.length > 0)
}

/**
 * Lyrics via the lyrics-lookup Edge Function (lrclib can't be called from the
 * browser). A miss is an empty state, never an error — the function already
 * folds lrclib's 404 and 503 into found:false.
 */
export async function getLyrics(
  artistName: string,
  trackTitle: string
): Promise<LyricsResult> {
  const { data, error } = await requireClient().functions.invoke('lyrics-lookup', {
    body: { artist: artistName, track: trackTitle },
  })
  if (error) throw error
  if (!data?.found) return { status: 'empty' }

  if (data.syncedLyrics) {
    const lines = parseLrc(data.syncedLyrics)
    if (lines.length) return { status: 'found', lines, synced: true }
  }
  if (data.plainLyrics) {
    const lines = data.plainLyrics
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
    if (lines.length) return { status: 'found', lines, synced: false }
  }
  return { status: 'empty' }
}

/* ------------------------------------------------------------ review writes */

/**
 * Create or edit the signed-in user's review. The reviews table has a unique
 * constraint on (song_id, user_id) — verified against the live schema — so
 * this is always an upsert, never a duplicate insert.
 *
 * `edited` and `updated_at` are only touched on an edit; a first submission
 * leaves the column defaults alone so "edited" means what it says.
 */
export async function upsertReview(args: {
  songId: string
  userId: string
  rating: number
  title: string | null
  body: string | null
  isEdit: boolean
}): Promise<ReviewWithAuthor> {
  const row: Record<string, unknown> = {
    song_id: args.songId,
    user_id: args.userId,
    rating: args.rating,
    title: args.title?.trim() ? args.title.trim() : null,
    body: args.body?.trim() ? args.body.trim() : null,
  }
  if (args.isEdit) {
    row.edited = true
    row.updated_at = new Date().toISOString()
  }

  const { data, error } = await requireClient()
    .from('reviews')
    .upsert(row, { onConflict: 'song_id,user_id' })
    .select(REVIEW_SELECT)
    .single()
  if (error) throw error

  // A freshly written review can't already be liked by its author.
  return toReviewModel(data as unknown as ReviewRow, false)
}

export async function deleteReview(songId: string, userId: string) {
  // RLS scopes this to the author anyway; the filter keeps intent explicit.
  const { error } = await requireClient()
    .from('reviews')
    .delete()
    .eq('song_id', songId)
    .eq('user_id', userId)
  if (error) throw error
}


/* --------------------------------------------------------- likes & comments */

/**
 * A like is binary — insert to add, delete to remove. There's no update path
 * and no policy for one, which is why the table's primary key is the pair.
 */
export async function setReviewLike(
  reviewId: string,
  userId: string,
  liked: boolean
) {
  const client = requireClient()
  if (liked) {
    const { error } = await client
      .from('review_likes')
      .insert({ review_id: reviewId, user_id: userId })
    // Racing a double-tap hits the composite PK; already-liked is success.
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await client
      .from('review_likes')
      .delete()
      .eq('review_id', reviewId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

type CommentRow = {
  id: string
  review_id: string
  user_id: string
  body: string
  created_at: string
  edited: boolean
  profiles: Rel<{
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }>
}

const COMMENT_SELECT =
  'id, review_id, user_id, body, created_at, edited, ' +
  'profiles(username, display_name, avatar_url)'

function toCommentModel(c: CommentRow): ReviewComment {
  const p = one(c.profiles)
  return {
    id: c.id,
    reviewId: c.review_id,
    userId: c.user_id,
    body: c.body,
    createdAt: c.created_at,
    edited: c.edited,
    author: p
      ? {
          username: p.username,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
        }
      : null,
  }
}

/** Oldest first — a comment thread reads as a conversation, not a feed. */
export async function getReviewComments(reviewId: string) {
  const { data, error } = await requireClient()
    .from('review_comments')
    .select(COMMENT_SELECT)
    .eq('review_id', reviewId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as CommentRow[]).map(toCommentModel)
}

export async function addReviewComment(
  reviewId: string,
  userId: string,
  body: string
) {
  const { data, error } = await requireClient()
    .from('review_comments')
    .insert({ review_id: reviewId, user_id: userId, body: body.trim() })
    .select(COMMENT_SELECT)
    .single()
  if (error) throw error
  return toCommentModel(data as unknown as CommentRow)
}

export async function deleteReviewComment(commentId: string, userId: string) {
  // RLS already scopes this to the author; the explicit filter matches
  // deleteReview and means a policy regression can't turn into a way to
  // delete other people's comments.
  const { error } = await requireClient()
    .from('review_comments')
    .delete()
    .eq('id', commentId)
    .eq('user_id', userId)
  if (error) throw error
}

/* ------------------------------------------------------------------ follows */

export async function getFollowedArtistIds(userId: string): Promise<Set<string>> {
  const { data, error } = await requireClient()
    .from('follows')
    .select('artist_id')
    .eq('user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map((f) => f.artist_id))
}

export async function getFollowedArtists(
  userId: string
): Promise<ArtistCardModel[]> {
  const { data, error } = await requireClient()
    .from('follows')
    .select('artists(id, name, image_url, genres)')
    .eq('user_id', userId)
  if (error) throw error

  return (data ?? [])
    .map((row) => one((row as { artists: Rel<{
      id: string
      name: string
      image_url: string | null
      genres: string[] | null
    }> }).artists))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      genres: a.genres ?? [],
    }))
}

/** Follow is binary, like a review like — insert to add, delete to remove. */
export async function setArtistFollow(
  userId: string,
  artistId: string,
  following: boolean
) {
  const client = requireClient()
  if (following) {
    const { error } = await client
      .from('follows')
      .insert({ user_id: userId, artist_id: artistId })
    // Racing a double-tap hits the unique constraint; already-followed is fine.
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await client
      .from('follows')
      .delete()
      .eq('user_id', userId)
      .eq('artist_id', artistId)
    if (error) throw error
  }
}

/* ----------------------------------------------------------------- profiles */

export async function getProfileDetail(
  userId: string
): Promise<ProfileDetail | null> {
  const client = requireClient()

  const { data, error } = await client
    .from('profiles')
    // `*` rather than a column list so this keeps working either side of
    // 0022, which adds is_private.
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    if (error.code === '22P02') return null // malformed uuid = bad link
    throw error
  }
  if (!data) return null

  // All three counts go through security definer functions. A private
  // profile still shows its numbers to a non-friend — only the rows behind
  // them are hidden — and after 0022 a direct count over reviews or follows
  // would read 0 for exactly those viewers.
  const [reviews, follows, friends] = await Promise.all([
    client.rpc('review_count', { target: userId }),
    client.rpc('following_count', { target: userId }),
    client.rpc('friend_count', { target: userId }),
  ])
  if (reviews.error && reviews.error.code !== 'PGRST202') throw reviews.error
  if (follows.error && follows.error.code !== 'PGRST202') throw follows.error

  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    bio: data.bio,
    avatarUrl: data.avatar_url,
    favoriteGenres: data.favorite_genres ?? [],
    reviewCount: reviews.error ? 0 : Number(reviews.data ?? 0),
    followingCount: follows.error ? 0 : Number(follows.data ?? 0),
    friendCount: friends.error ? 0 : ((friends.data as number | null) ?? 0),
    isPrivate: Boolean((data as { is_private?: boolean }).is_private),
  }
}

type ReviewWithSongRow = {
  id: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
  edited: boolean
  songs: Rel<{
    id: string
    title: string
    artists: Rel<{ name: string }>
    albums: Rel<{ cover_url: string | null }>
  }>
}

/** Every review this user has written, newest first, with song context. */
export async function getReviewsByUser(
  userId: string
): Promise<ReviewWithSong[]> {
  const { data, error } = await requireClient()
    .from('reviews')
    .select(
      'id, rating, title, body, created_at, edited, ' +
        'songs(id, title, artists(name), albums(cover_url))'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as ReviewWithSongRow[]).map((r) => {
    const song = one(r.songs)
    return {
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      edited: r.edited,
      song: song
        ? {
            id: song.id,
            title: song.title,
            artistName: one(song.artists)?.name ?? 'Unknown artist',
            coverUrl: one(song.albums)?.cover_url ?? null,
          }
        : null,
    }
  })
}

export async function updateProfile(
  userId: string,
  patch: {
    display_name?: string | null
    bio?: string | null
    favorite_genres?: string[] | null
    avatar_url?: string | null
  }
) {
  const { error } = await requireClient()
    .from('profiles')
    .update(patch)
    .eq('id', userId)
  if (error) throw error
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Uploads to avatars/{userId}/… — storage policies key on that first path
 * segment, so the path is what enforces ownership, not the filename.
 */
export async function uploadAvatar(userId: string, file: File) {
  const client = requireClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${userId}/avatar-${Date.now()}.${ext}`

  const { error } = await client.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error

  const { data } = client.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/* --------------------------------------------------------------- song likes */

/**
 * Liking a song is separate from reviewing it — a user can do either, both,
 * or neither. Binary like the artist follow: insert to add, delete to remove.
 */
export async function setSongLike(
  userId: string,
  songId: string,
  liked: boolean
) {
  const client = requireClient()
  if (liked) {
    const { error } = await client
      .from('song_likes')
      .insert({ user_id: userId, song_id: songId })
    // Racing a double-tap hits the composite PK; already-liked is success.
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await client
      .from('song_likes')
      .delete()
      .eq('user_id', userId)
      .eq('song_id', songId)
    if (error) throw error
  }
}

export async function isSongLiked(userId: string, songId: string) {
  const { data, error } = await requireClient()
    .from('song_likes')
    .select('song_id')
    .eq('user_id', userId)
    .eq('song_id', songId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

type LikedSongRow = {
  songs: Rel<{
    id: string
    title: string
    genre: string | null
    artist_id: string
    artists: Rel<{ name: string }>
    albums: Rel<{ cover_url: string | null }>
  }>
}

/** Songs this user liked, newest first. */
export async function getLikedSongs(userId: string): Promise<SongCardModel[]> {
  const { data, error } = await requireClient()
    .from('song_likes')
    .select(
      'created_at, songs(id, title, genre, artist_id, artists(name), albums(cover_url))'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = ((data ?? []) as unknown as LikedSongRow[])
    .map((r) => one(r.songs))
    .filter((s): s is NonNullable<typeof s> => Boolean(s)) as unknown as SongRow[]

  return decorate(rows)
}

/* ------------------------------------------------------- people & friendships */

const PERSON_SELECT = 'id, username, display_name, avatar_url'

function toPerson(r: {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
}): PersonCardModel {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
  }
}

/** Matches username or display name. Never returns the viewer themselves. */
export async function searchPeople(
  query: string,
  viewerId?: string,
  limit = 20
): Promise<PersonCardModel[]> {
  const q = query.trim()
  if (!q) return []

  const { data, error } = await requireClient()
    .from('profiles')
    .select(PERSON_SELECT)
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(limit)
  if (error) throw error

  return (data ?? []).filter((r) => r.id !== viewerId).map(toPerson)
}

type FriendshipRow = { user_id: string; friend_id: string; status: string }

/**
 * Friend state for a set of people, from the viewer's point of view.
 * friendships is private, so this only ever returns rows the viewer is in.
 */
export async function getFriendStates(
  viewerId: string,
  personIds: string[]
): Promise<Map<string, FriendState>> {
  const states = new Map<string, FriendState>()
  if (personIds.length === 0) return states

  const { data, error } = await requireClient()
    .from('friendships')
    .select('user_id, friend_id, status')
    .or(`user_id.eq.${viewerId},friend_id.eq.${viewerId}`)
  if (error) throw error

  const wanted = new Set(personIds)
  for (const row of (data ?? []) as FriendshipRow[]) {
    const other = row.user_id === viewerId ? row.friend_id : row.user_id
    if (!wanted.has(other)) continue
    if (row.status === 'accepted') states.set(other, 'friends')
    else states.set(other, row.user_id === viewerId ? 'outgoing' : 'incoming')
  }
  return states
}

/**
 * Sends a request, or accepts theirs if they already asked you. Done in one
 * server-side statement so two people tapping at once can't create a pair of
 * crossed pending rows.
 */
export async function requestFriendship(targetId: string): Promise<FriendState> {
  const { data, error } = await requireClient().rpc('request_friendship', {
    target: targetId,
  })
  if (error) throw error
  return data === 'accepted' ? 'friends' : 'outgoing'
}

/** Only the recipient may accept, enforced by RLS. */
export async function acceptFriendship(requesterId: string, viewerId: string) {
  const { error } = await requireClient()
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('user_id', requesterId)
    .eq('friend_id', viewerId)
  if (error) throw error
}

/** Cancel, decline, or unfriend — the row goes either way round. */
export async function removeFriendship(viewerId: string, otherId: string) {
  const { error } = await requireClient()
    .from('friendships')
    .delete()
    .or(
      `and(user_id.eq.${viewerId},friend_id.eq.${otherId}),` +
        `and(user_id.eq.${otherId},friend_id.eq.${viewerId})`
    )
  if (error) throw error
}

type FriendshipWithPeople = {
  user_id: string
  friend_id: string
  status: string
  requester: Rel<{
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }>
  recipient: Rel<{
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }>
}

/** Everything the Friends view needs, in one query. */
export async function getFriendships(viewerId: string): Promise<{
  incoming: FriendEdge[]
  outgoing: FriendEdge[]
  friends: FriendEdge[]
}> {
  const { data, error } = await requireClient()
    .from('friendships')
    .select(
      'user_id, friend_id, status, ' +
        `requester:profiles!friendships_user_id_fkey(${PERSON_SELECT}), ` +
        `recipient:profiles!friendships_friend_id_fkey(${PERSON_SELECT})`
    )
    .or(`user_id.eq.${viewerId},friend_id.eq.${viewerId}`)
  if (error) throw error

  const incoming: FriendEdge[] = []
  const outgoing: FriendEdge[] = []
  const friends: FriendEdge[] = []

  for (const row of (data ?? []) as unknown as FriendshipWithPeople[]) {
    const mine = row.user_id === viewerId
    const other = one(mine ? row.recipient : row.requester)
    if (!other) continue
    const edge = { person: toPerson(other), state: 'none' as FriendState }

    if (row.status === 'accepted') friends.push({ ...edge, state: 'friends' })
    else if (mine) outgoing.push({ ...edge, state: 'outgoing' })
    else incoming.push({ ...edge, state: 'incoming' })
  }

  return { incoming, outgoing, friends }
}

export async function getFriendCount(userId: string) {
  const { data, error } = await requireClient().rpc('friend_count', {
    target: userId,
  })
  if (error) throw error
  return (data as number | null) ?? 0
}

/** Case-insensitive availability check for the signup form. */
export async function isUsernameAvailable(username: string) {
  const name = username.trim().toLowerCase()
  if (!name) return false
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id')
    .ilike('username', name)
    .limit(1)
  if (error) throw error
  return (data ?? []).length === 0
}

/* ------------------------------------------------------------ unified search */

/**
 * One query, every result type. Sections run in parallel and a failing
 * section yields an empty list rather than taking the page down with it.
 *
 * Lyrics are deliberately excluded: that path costs one lyrics-lookup Edge
 * Function call per candidate song, which is far too slow to run on every
 * keystroke. Explore asks for it explicitly via searchCatalog(mode:'lyrics').
 */
export async function searchEverything(
  query: string,
  genre: string | null,
  viewerId?: string
): Promise<UnifiedResults> {
  const trimmed = query.trim()

  const [songsRes, artistsRes, peopleRes] = await Promise.allSettled([
    searchCatalog(trimmed, 'songs', genre),
    searchCatalog(trimmed, 'artists', genre),
    // People aren't part of the music catalog, so no genre filter applies.
    trimmed ? searchPeople(trimmed, viewerId) : Promise.resolve([]),
  ])

  if (songsRes.status === 'rejected')
    console.error('[beatboxed] song search failed:', songsRes.reason)
  if (artistsRes.status === 'rejected')
    console.error('[beatboxed] artist search failed:', artistsRes.reason)
  if (peopleRes.status === 'rejected')
    console.error('[beatboxed] people search failed:', peopleRes.reason)

  const songs =
    songsRes.status === 'fulfilled' && songsRes.value.mode === 'songs'
      ? songsRes.value.songs
      : []
  const artists =
    artistsRes.status === 'fulfilled' && artistsRes.value.mode === 'artists'
      ? artistsRes.value.artists
      : []
  const people = peopleRes.status === 'fulfilled' ? peopleRes.value : []

  // Either catalog section may have hit the Spotify top-up; surface one note.
  const warning =
    (songsRes.status === 'fulfilled' ? songsRes.value.warning : undefined) ??
    (artistsRes.status === 'fulfilled' ? artistsRes.value.warning : undefined)

  return { songs, artists, people, warning }
}

/* ----------------------------------------------------------- notifications */

/**
 * Everything the bell needs, in one call.
 *
 * Pending friend requests come straight from friendships rather than from a
 * stored notification, so cancelling or declining elsewhere removes them here
 * with nothing to reconcile.
 */
export async function getNotificationCenter(
  viewerId: string
): Promise<NotificationCenter> {
  const client = requireClient()

  const [friendships, notifs, announcements, reads, prefs] = await Promise.all([
    getFriendships(viewerId),
    client
      .from('notifications')
      .select('id, type, payload, read, created_at')
      .eq('user_id', viewerId)
      .order('created_at', { ascending: false })
      .limit(50),
    client
      .from('announcements')
      .select('id, title, body, link, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    client.from('announcement_reads').select('announcement_id').eq('user_id', viewerId),
    // Two of the six switches can't be enforced in notify(): pending friend
    // requests are read live from friendships, and announcements are a
    // shared table with no per-user rows. They're applied here instead.
    getNotificationPrefs(viewerId),
  ])
  if (notifs.error) throw notifs.error
  if (announcements.error) throw announcements.error
  if (reads.error) throw reads.error

  const readIds = new Set((reads.data ?? []).map((r) => r.announcement_id))

  const notifications: NotificationRow[] = (notifs.data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    payload: (n.payload ?? {}) as Record<string, unknown>,
    read: n.read,
    createdAt: n.created_at,
  }))

  // Turned off, so they leave the page and the badge entirely.
  const anns: Announcement[] = (prefs.announcements ? (announcements.data ?? []) : []).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    link: a.link,
    createdAt: a.created_at,
    read: readIds.has(a.id),
  }))

  const updates: UpdateItem[] = [
    ...notifications.map(
      (n): UpdateItem => ({ kind: 'notification', at: n.createdAt, notification: n })
    ),
    ...anns.map(
      (a): UpdateItem => ({ kind: 'announcement', at: a.createdAt, announcement: a })
    ),
  ].sort((x, y) => (x.at < y.at ? 1 : -1))

  const badge =
    // Turning requests off stops them counting, but they stay listed on the
    // Friend requests page: losing sight of a request someone sent you is
    // worse than a quiet badge.
    (prefs.friend_requests ? friendships.incoming.length : 0) +
    notifications.filter((n) => !n.read).length +
    anns.filter((a) => !a.read).length

  return { requests: friendships.incoming, updates, badge }
}

export async function markNotificationRead(id: string) {
  const { error } = await requireClient()
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
  if (error) throw error
}

export async function markAnnouncementRead(announcementId: string, userId: string) {
  const { error } = await requireClient()
    .from('announcement_reads')
    .insert({ user_id: userId, announcement_id: announcementId })
  // Already marked is success, not an error.
  if (error && error.code !== '23505') throw error
}

export async function markAllRead(viewerId: string, updates: UpdateItem[]) {
  const client = requireClient()
  const unreadNotifs = updates
    .filter((u) => u.kind === 'notification' && !u.notification.read)
    .map((u) => (u as Extract<UpdateItem, { kind: 'notification' }>).notification.id)
  const unreadAnns = updates
    .filter((u) => u.kind === 'announcement' && !u.announcement.read)
    .map((u) => (u as Extract<UpdateItem, { kind: 'announcement' }>).announcement.id)

  await Promise.all([
    unreadNotifs.length
      ? client.from('notifications').update({ read: true }).in('id', unreadNotifs)
      : Promise.resolve(),
    unreadAnns.length
      ? client.from('announcement_reads').upsert(
          unreadAnns.map((id) => ({ user_id: viewerId, announcement_id: id })),
          { onConflict: 'user_id,announcement_id' }
        )
      : Promise.resolve(),
  ])
}

/** Display details for the people referenced by notification payloads. */
export async function getPeopleByIds(
  ids: string[]
): Promise<Map<string, PersonCardModel>> {
  const map = new Map<string, PersonCardModel>()
  if (ids.length === 0) return map

  const { data, error } = await requireClient()
    .from('profiles')
    .select(PERSON_SELECT)
    .in('id', ids)
  if (error) throw error

  for (const row of data ?? []) map.set(row.id, toPerson(row))
  return map
}

/**
 * Everything the notification renderers need to turn id-only payloads into
 * readable text: who acted, which song, and the opening words of a comment.
 * Three batched queries rather than one per notification.
 */
export async function getNotificationContext(
  notifications: NotificationRow[]
): Promise<{
  people: Map<string, PersonCardModel>
  songs: Map<string, string>
  comments: Map<string, string>
}> {
  const client = requireClient()
  const str = (v: unknown) => (typeof v === 'string' ? v : null)

  const personIds = new Set<string>()
  const songIds = new Set<string>()
  const commentIds = new Set<string>()

  for (const n of notifications) {
    for (const key of ['actor_id', 'friend_id', 'review_author_id']) {
      const v = str(n.payload[key])
      if (v) personIds.add(v)
    }
    const song = str(n.payload.song_id)
    if (song) songIds.add(song)
    const comment = str(n.payload.comment_id)
    if (comment) commentIds.add(comment)
  }

  const [people, songs, comments] = await Promise.all([
    personIds.size ? getPeopleByIds([...personIds]) : Promise.resolve(new Map()),
    songIds.size
      ? client.from('songs').select('id, title').in('id', [...songIds])
      : Promise.resolve({ data: [], error: null }),
    commentIds.size
      ? client.from('review_comments').select('id, body').in('id', [...commentIds])
      : Promise.resolve({ data: [], error: null }),
  ])

  const songMap = new Map<string, string>()
  if (!songs.error) for (const s of songs.data ?? []) songMap.set(s.id, s.title)

  const commentMap = new Map<string, string>()
  if (!comments.error) for (const c of comments.data ?? []) commentMap.set(c.id, c.body)

  return { people, songs: songMap, comments: commentMap }
}

/* ------------------------------------------------------------ full lists */

/**
 * Someone's accepted friends, via the security definer function — the
 * friendships table itself is readable only by the two people in a row.
 * Returns an empty list when the owner has hidden their list; callers read
 * profiles.friends_list_visible to tell "hidden" from "none".
 */
export async function getFriendsPublic(
  targetId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<PersonCardModel[]> {
  const { data, error } = await requireClient().rpc('get_friends', {
    target: targetId,
  })
  if (error) throw error

  const rows = (data ?? []) as {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }[]

  // The function returns the whole list; page it here rather than adding
  // limit/offset arguments the UI would have to keep in step.
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? rows.length
  return rows.slice(offset, offset + limit).map(toPerson)
}

export async function getFollowedArtistsPage(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<ArtistCardModel[]> {
  const limit = opts.limit ?? 30
  const offset = opts.offset ?? 0

  const { data, error } = await requireClient()
    .from('follows')
    .select('artists(id, name, image_url, genres)')
    .eq('user_id', userId)
    .range(offset, offset + limit - 1)
  if (error) throw error

  return (data ?? [])
    .map((row) =>
      one(
        (row as {
          artists: Rel<{
            id: string
            name: string
            image_url: string | null
            genres: string[] | null
          }>
        }).artists
      )
    )
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      genres: a.genres ?? [],
    }))
}

export type ReviewSort = 'newest' | 'highest' | 'lowest'

export async function getReviewsByUserPage(
  userId: string,
  opts: { limit?: number; offset?: number; sort?: ReviewSort } = {}
): Promise<ReviewWithSong[]> {
  const limit = opts.limit ?? 30
  const offset = opts.offset ?? 0
  const sort = opts.sort ?? 'newest'

  let q = requireClient()
    .from('reviews')
    .select(
      'id, rating, title, body, created_at, edited, ' +
        'songs(id, title, artists(name), albums(cover_url))'
    )
    .eq('user_id', userId)

  if (sort === 'highest') q = q.order('rating', { ascending: false })
  else if (sort === 'lowest') q = q.order('rating', { ascending: true })
  // Newest is the tiebreak in every mode, so equal ratings stay stable.
  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

  const { data, error } = await q
  if (error) throw error

  return ((data ?? []) as unknown as ReviewWithSongRow[]).map((r) => {
    const song = one(r.songs)
    return {
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      edited: r.edited,
      song: song
        ? {
            id: song.id,
            title: song.title,
            artistName: one(song.artists)?.name ?? 'Unknown artist',
            coverUrl: one(song.albums)?.cover_url ?? null,
          }
        : null,
    }
  })
}

/** Whether this person's friend list is public. profiles is world-readable. */
export async function getFriendsListVisible(targetId: string) {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('friends_list_visible')
    .eq('id', targetId)
    .maybeSingle()
  if (error) throw error
  return data?.friends_list_visible ?? true
}
