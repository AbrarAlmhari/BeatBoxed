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
