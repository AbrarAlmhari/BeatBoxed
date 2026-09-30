/**
 * Row shapes mirroring the tables in docs/data-model.md. Field names match the
 * schema exactly — if the team changes a column, change it here, not per-slice.
 */

export type Artist = {
  id: string
  spotify_id: string | null
  name: string
  image_url: string | null
  genres: string[]
}

export type Album = {
  id: string
  spotify_id: string | null
  title: string
  artist_id: string
  cover_url: string | null
  release_date: string | null
}

export type Song = {
  id: string
  spotify_id: string | null
  title: string
  artist_id: string
  album_id: string
  duration_ms: number
  genre: string | null
}

export type Review = {
  id: string
  song_id: string
  user_id: string
  rating: number
  body: string | null
  created_at: string
  updated_at: string
  edited: boolean
}

/** Flattened song + its artist/album/review aggregates, ready to render. */
export type SongCardModel = {
  id: string
  title: string
  artistName: string
  coverUrl: string | null
  ratingAvg: number | null
  reviewCount: number
}

export type ArtistCardModel = {
  id: string
  name: string
  imageUrl: string | null
  genres: string[]
}

/** One matching lyric line plus enough context to link back to the song. */
export type LyricMatch = {
  songId: string
  songTitle: string
  artistName: string
  line: string
}

export type SearchMode = 'songs' | 'artists' | 'lyrics'

/** `warning` carries a non-fatal problem (e.g. the Spotify top-up failed) so
 *  the UI can say so instead of silently showing fewer results. */
export type SearchResults =
  | { mode: 'songs'; songs: SongCardModel[]; warning?: string }
  | { mode: 'artists'; artists: ArtistCardModel[]; warning?: string }
  | { mode: 'lyrics'; lyrics: LyricMatch[]; warning?: string }

/** A song plus its cached artist/album context, for the song detail page. */
export type SongDetail = {
  id: string
  title: string
  genre: string | null
  durationMs: number
  spotifyId: string | null
  artist: { id: string; name: string; imageUrl: string | null } | null
  album: {
    id: string
    title: string
    coverUrl: string | null
    releaseDate: string | null
  } | null
  ratingAvg: number | null
  reviewCount: number
}

export type ReviewWithAuthor = {
  id: string
  /** Needed to tell the signed-in user's own review apart from everyone else's. */
  userId: string
  rating: number
  title: string | null
  body: string | null
  createdAt: string
  edited: boolean
  likeCount: number
  /** False when signed out — nobody's like state to show. */
  likedByMe: boolean
  commentCount: number
  author: {
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  } | null
}

export type LyricsResult =
  | { status: 'found'; lines: string[]; synced: boolean }
  | { status: 'empty' }

export type ReviewComment = {
  id: string
  reviewId: string
  userId: string
  body: string
  createdAt: string
  edited: boolean
  author: {
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  } | null
}

export type ProfileDetail = {
  id: string
  username: string | null
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  favoriteGenres: string[]
  reviewCount: number
  followingCount: number
}

/** A review joined with enough song context to render it off the song page. */
export type ReviewWithSong = {
  id: string
  rating: number
  title: string | null
  body: string | null
  createdAt: string
  edited: boolean
  song: {
    id: string
    title: string
    artistName: string
    coverUrl: string | null
  } | null
}
