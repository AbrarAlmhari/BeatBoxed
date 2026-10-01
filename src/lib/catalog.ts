import { supabase } from './supabase'
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
 * Review aggregates for a set of songs. Postgres could do this in one grouped
 * query via a view, but the schema is locked for Week 1 — aggregating a single
 * fetched page client-side avoids a migration for now.
 */
async function ratingsFor(songIds: string[]) {
  const stats = new Map<string, { avg: number | null; count: number }>()
  if (songIds.length === 0) return stats

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

export type HomeFeed = {
  continueListening: SongCardModel[]
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

  // No play-history table exists in docs/data-model.md, so this stays empty
  // rather than being faked with arbitrary songs.
  const continueListening: SongCardModel[] = []

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
    .select('id, username, display_name, bio, avatar_url, favorite_genres')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    if (error.code === '22P02') return null // malformed uuid = bad link
    throw error
  }
  if (!data) return null

  const [reviews, follows, friends] = await Promise.all([
    client
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    client
      .from('follows')
      .select('artist_id', { count: 'exact', head: true })
      .eq('user_id', userId),
    // friendships is private, so this only resolves for your own profile;
    // viewing someone else's simply counts zero rather than erroring.
    client
      .from('friendships')
      .select('user_id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`),
  ])
  if (reviews.error) throw reviews.error
  if (follows.error) throw follows.error

  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    bio: data.bio,
    avatarUrl: data.avatar_url,
    favoriteGenres: data.favorite_genres ?? [],
    reviewCount: reviews.count ?? 0,
    followingCount: follows.count ?? 0,
    friendCount: friends.error ? 0 : (friends.count ?? 0),
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
  const { count, error } = await requireClient()
    .from('friendships')
    .select('user_id', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
  if (error) throw error
  return count ?? 0
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
