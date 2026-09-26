import type {
  Album,
  Artist,
  ArtistCardModel,
  LyricMatch,
  Review,
  SearchMode,
  SearchResults,
  Song,
  SongCardModel,
} from './types'

/**
 * Stand-in data until the Supabase tables are seeded. Rows match the columns in
 * docs/data-model.md exactly, so swapping in real queries means rewriting only
 * getHomeFeedData() below — no component changes.
 *
 * cover_url / image_url are null on purpose: real values will be Spotify CDN
 * URLs, and pointing at fake ones would 404 on every render. Cards fall back to
 * a generated gradient when the value is null.
 */

export const mockArtists: Artist[] = [
  { id: 'ar1', spotify_id: null, name: 'Halcyon Mercer', image_url: null, genres: ['indie', 'dream pop'] },
  { id: 'ar2', spotify_id: null, name: 'Noor Rahal', image_url: null, genres: ['alt r&b'] },
  { id: 'ar3', spotify_id: null, name: 'The Paper Lanterns', image_url: null, genres: ['indie rock'] },
  { id: 'ar4', spotify_id: null, name: 'Sable Court', image_url: null, genres: ['electronic', 'ambient'] },
  { id: 'ar5', spotify_id: null, name: 'Yuna Vale', image_url: null, genres: ['synthpop'] },
  // Arabic entries are deliberate: design-system.md requires RTL support, so
  // the mock feed should surface RTL text before the real catalog does.
  { id: 'ar6', spotify_id: null, name: 'قمر', image_url: null, genres: ['arabic pop'] },
]

export const mockAlbums: Album[] = [
  { id: 'al1', spotify_id: null, title: 'Midnight Static', artist_id: 'ar1', cover_url: null, release_date: '2024-03-15' },
  { id: 'al2', spotify_id: null, title: 'Low Tide', artist_id: 'ar2', cover_url: null, release_date: '2023-09-01' },
  { id: 'al3', spotify_id: null, title: 'Paper Lanterns', artist_id: 'ar3', cover_url: null, release_date: '2025-01-20' },
  { id: 'al4', spotify_id: null, title: 'Velvet Noise', artist_id: 'ar4', cover_url: null, release_date: '2024-11-08' },
  { id: 'al5', spotify_id: null, title: 'Amber Hours', artist_id: 'ar5', cover_url: null, release_date: '2025-06-02' },
  { id: 'al6', spotify_id: null, title: 'ليل', artist_id: 'ar6', cover_url: null, release_date: '2025-04-11' },
]

export const mockSongs: Song[] = [
  { id: 's1', spotify_id: null, title: 'Slow Reverb', artist_id: 'ar1', album_id: 'al1', duration_ms: 214000, genre: 'dream pop' },
  { id: 's2', spotify_id: null, title: 'After Rain', artist_id: 'ar1', album_id: 'al1', duration_ms: 198000, genre: 'dream pop' },
  { id: 's3', spotify_id: null, title: 'Blue Hour', artist_id: 'ar2', album_id: 'al2', duration_ms: 236000, genre: 'alt r&b' },
  { id: 's4', spotify_id: null, title: 'Signal Drift', artist_id: 'ar2', album_id: 'al2', duration_ms: 187000, genre: 'alt r&b' },
  { id: 's5', spotify_id: null, title: 'Ghost Chorus', artist_id: 'ar3', album_id: 'al3', duration_ms: 251000, genre: 'indie rock' },
  { id: 's6', spotify_id: null, title: 'Night Bus', artist_id: 'ar3', album_id: 'al3', duration_ms: 203000, genre: 'indie rock' },
  { id: 's7', spotify_id: null, title: 'Soft Static', artist_id: 'ar4', album_id: 'al4', duration_ms: 268000, genre: 'ambient' },
  { id: 's8', spotify_id: null, title: 'Undertow', artist_id: 'ar4', album_id: 'al4', duration_ms: 222000, genre: 'electronic' },
  { id: 's9', spotify_id: null, title: 'Amber Hours', artist_id: 'ar5', album_id: 'al5', duration_ms: 195000, genre: 'synthpop' },
  { id: 's10', spotify_id: null, title: 'Glass Weather', artist_id: 'ar5', album_id: 'al5', duration_ms: 241000, genre: 'synthpop' },
  { id: 's11', spotify_id: null, title: 'ليلة هادئة', artist_id: 'ar6', album_id: 'al6', duration_ms: 229000, genre: 'arabic pop' },
  { id: 's12', spotify_id: null, title: 'Qamar', artist_id: 'ar6', album_id: 'al6', duration_ms: 208000, genre: 'arabic pop' },
]

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString()

export const mockReviews: Review[] = [
  { id: 'r1', song_id: 's5', user_id: 'u1', rating: 5, body: 'The bridge wrecked me.', created_at: iso(1), updated_at: iso(1), edited: false },
  { id: 'r2', song_id: 's5', user_id: 'u2', rating: 5, body: null, created_at: iso(2), updated_at: iso(2), edited: false },
  { id: 'r3', song_id: 's5', user_id: 'u3', rating: 4, body: 'Great, slightly long.', created_at: iso(3), updated_at: iso(3), edited: true },
  { id: 'r4', song_id: 's3', user_id: 'u1', rating: 5, body: 'On repeat all week.', created_at: iso(1), updated_at: iso(1), edited: false },
  { id: 'r5', song_id: 's3', user_id: 'u4', rating: 4, body: null, created_at: iso(4), updated_at: iso(4), edited: false },
  { id: 'r6', song_id: 's1', user_id: 'u2', rating: 4, body: 'Warm production.', created_at: iso(5), updated_at: iso(5), edited: false },
  { id: 'r7', song_id: 's11', user_id: 'u5', rating: 5, body: 'Beautiful lyrics.', created_at: iso(2), updated_at: iso(2), edited: false },
  { id: 'r8', song_id: 's11', user_id: 'u3', rating: 5, body: null, created_at: iso(6), updated_at: iso(6), edited: false },
  { id: 'r9', song_id: 's7', user_id: 'u4', rating: 3, body: 'Good background listen.', created_at: iso(7), updated_at: iso(7), edited: false },
  { id: 'r10', song_id: 's9', user_id: 'u1', rating: 4, body: null, created_at: iso(3), updated_at: iso(3), edited: false },
]

/**
 * No table backs "recently played" yet — docs/data-model.md has no play-history
 * table. Raised with the team; this stays client-side mock until the schema
 * adds one. Deliberately not named after a table so it can't be mistaken for
 * an existing one.
 */
const recentlyPlayedSongIds = ['s3', 's7', 's1', 's11', 's5', 's9']

/** Stand-in for the follows table: artists this user follows. */
const followedArtistIds = ['ar1', 'ar4', 'ar6']

function toCardModel(song: Song): SongCardModel {
  const artist = mockArtists.find((a) => a.id === song.artist_id)
  const album = mockAlbums.find((al) => al.id === song.album_id)
  const reviews = mockReviews.filter((r) => r.song_id === song.id)
  const ratingAvg = reviews.length
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : null

  return {
    id: song.id,
    title: song.title,
    artistName: artist?.name ?? 'Unknown artist',
    coverUrl: album?.cover_url ?? null,
    ratingAvg,
    reviewCount: reviews.length,
  }
}

export type HomeFeed = {
  continueListening: SongCardModel[]
  trending: SongCardModel[]
  forYou: SongCardModel[]
}

/**
 * The single seam between the Home UI and its data. Replacing these three
 * arrays with Supabase queries should not touch any component.
 */
export async function getHomeFeedData(): Promise<HomeFeed> {
  const byId = (id: string) => mockSongs.find((s) => s.id === id)

  const continueListening = recentlyPlayedSongIds
    .map(byId)
    .filter((s): s is Song => Boolean(s))
    .map(toCardModel)

  // "Trending" = review activity first, then average rating.
  const trending = [...mockSongs]
    .map(toCardModel)
    .filter((s) => s.reviewCount > 0)
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount || (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0)
    )
    .slice(0, 8)

  // Placeholder for real recommendations: songs by artists the user follows.
  const forYou = mockSongs
    .filter((s) => followedArtistIds.includes(s.artist_id))
    .map(toCardModel)
    .slice(0, 8)

  return { continueListening, trending, forYou }
}

/* ------------------------------------------------------------------ search */

/**
 * No lyrics table exists, and none should: docs/api-integrations.md sources
 * lyrics from lrclib.net at request time rather than mirroring them. These
 * lines stand in for that fetch so lyrics-mode search is demoable offline.
 * Keyed by song id, matching what lrclib returns for a track.
 */
const mockLyricLines: Record<string, string[]> = {
  s1: ['Slow reverb on a empty street', 'The night keeps time with my heartbeat'],
  s3: ['Blue hour bleeding through the blinds', 'I keep your name behind my eyes'],
  s5: ['A ghost chorus in the hallway', 'Singing every word I never said'],
  s7: ['Soft static on the radio', 'Everything is quiet, let it go'],
  s9: ['Amber hours, honey light', 'We were golden for a night'],
  s11: ['ليلة هادئة والقمر بعيد', 'أسمع صوتك في الصدى'],
  s12: ['Qamar, you light the whole room', 'Even when the morning comes too soon'],
}

/** Unique genre list derived from the catalog, so chips are never hardcoded. */
export function getGenres(): string[] {
  const seen = new Set<string>()
  for (const song of mockSongs) if (song.genre) seen.add(song.genre)
  for (const artist of mockArtists) for (const g of artist.genres) seen.add(g)
  return [...seen].sort()
}

export const popularSearches = [
  'Ghost Chorus',
  'Noor Rahal',
  'dream pop',
  'Amber Hours',
  'Sable Court',
  'قمر',
]

function toArtistCardModel(artist: Artist): ArtistCardModel {
  return {
    id: artist.id,
    name: artist.name,
    imageUrl: artist.image_url,
    genres: artist.genres,
  }
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * The only place search behaviour lives. Swapping to Supabase full-text search
 * (and lrclib for lyrics) means rewriting this body and nothing else.
 */
export function searchCatalog(
  query: string,
  mode: SearchMode,
  genre: string | null
): SearchResults {
  const q = norm(query)

  if (mode === 'artists') {
    const artists = mockArtists
      .filter((a) => (genre ? a.genres.includes(genre) : true))
      .filter((a) => (q ? norm(a.name).includes(q) : true))
      .map(toArtistCardModel)
    return { mode: 'artists', artists }
  }

  const songsInScope = mockSongs.filter((s) => {
    if (!genre) return true
    if (s.genre === genre) return true
    const artist = mockArtists.find((a) => a.id === s.artist_id)
    return artist?.genres.includes(genre) ?? false
  })

  if (mode === 'lyrics') {
    const lyrics: LyricMatch[] = []
    for (const song of songsInScope) {
      for (const line of mockLyricLines[song.id] ?? []) {
        if (!q || norm(line).includes(q)) {
          lyrics.push({
            songId: song.id,
            songTitle: song.title,
            artistName:
              mockArtists.find((a) => a.id === song.artist_id)?.name ??
              'Unknown artist',
            line,
          })
        }
      }
    }
    return { mode: 'lyrics', lyrics }
  }

  const songs = songsInScope
    .filter((s) => {
      if (!q) return true
      const artist = mockArtists.find((a) => a.id === s.artist_id)
      return norm(s.title).includes(q) || norm(artist?.name ?? '').includes(q)
    })
    .map(toCardModel)

  return { mode: 'songs', songs }
}
