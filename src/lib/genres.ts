import { supabase } from './supabase'

/**
 * Artist genres (Part C). Each artist's raw genres (from Wikidata, or
 * MusicBrainz) are grouped in the database into at most two buckets; see
 * supabase/migrations/0031_artist_genres.sql. Songs carry no genre in the
 * UI any more: a song's genres are its artist's.
 */

/** Shorter labels for charts and chips; the database's genre_buckets.short_label. */
const SHORT: Record<string, string> = {
  'Hip-Hop & Rap': 'Hip-Hop',
  'Indie & Alternative': 'Indie & Alt',
  'Electronic & Dance': 'Electronic',
}

export function genreLabel(bucket: string) {
  return SHORT[bucket] ?? bucket
}

/**
 * Asks for an artist's genres the first time their page opens (the
 * artist-genres Edge Function looks them up and stores them). Returns the
 * buckets, or null if the lookup couldn't run; the page simply shows none.
 */
export async function fetchArtistGenres(artistId: string): Promise<string[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.functions.invoke('artist-genres', { body: { artistId } })
  if (error) {
    console.warn('[beatboxed] genre lookup failed:', error.message)
    return null
  }
  return (data as { genres?: string[] } | null)?.genres ?? null
}
