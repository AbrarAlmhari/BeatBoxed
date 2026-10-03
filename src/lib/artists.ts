import { supabase } from './supabase'
import type { SongCardModel } from './types'

/**
 * Reads behind the artist and album pages, plus the cache-fill calls to the
 * spotify-artist Edge Function.
 *
 * The pages always render from our own tables. A sync is fired alongside and
 * its result is picked up on the next read, so an artist page never waits on
 * Spotify to show something.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

type Rel<T> = T | T[] | null
const one = <T,>(v: Rel<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

/** Re-sync a discography at most this often. */
const SYNC_AFTER_HOURS = 24

export type ArtistAlbum = {
  id: string
  title: string
  coverUrl: string | null
  releaseDate: string | null
  year: number | null
  albumType: string | null
  totalTracks: number | null
}

export type ArtistDetail = {
  id: string
  spotifyId: string | null
  name: string
  imageUrl: string | null
  genres: string[]
  bio: string | null
  bioUrl: string | null
  bioFetchedAt: string | null
  discographySyncedAt: string | null
  followerCount: number
  topSongs: SongCardModel[]
  albums: ArtistAlbum[]
  singles: ArtistAlbum[]
}

export type AlbumTrack = SongCardModel & {
  trackNumber: number | null
  discNumber: number | null
  durationMs: number | null
  artistId: string | null
}

export type AlbumDetail = {
  id: string
  spotifyId: string | null
  title: string
  coverUrl: string | null
  releaseDate: string | null
  albumType: string | null
  totalTracks: number | null
  artistId: string | null
  artistName: string
  tracks: AlbumTrack[]
}

const yearOf = (date: string | null) =>
  date ? Number(date.slice(0, 4)) || null : null

/* ------------------------------------------------------------- the artist */

/**
 * Top songs come from our own catalog, ordered by the stored popularity
 * rank. Spotify's /top-tracks is 403 for this app's credentials — verified
 * through a deployed Edge Function — so there is no global top-10 to read.
 * This is "their songs we know about, best first".
 */
async function topSongsFor(artistId: string, limit = 8) {
  const { data, error } = await requireClient()
    .from('songs')
    .select('id, title, artist_id, artists(name), albums(cover_url)')
    .eq('artist_id', artistId)
    .order('popularity', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      title: string
      artists: Rel<{ name: string }>
      albums: Rel<{ cover_url: string | null }>
    }
    return {
      id: r.id,
      title: r.title,
      artistName: one(r.artists)?.name ?? 'Unknown artist',
      coverUrl: one(r.albums)?.cover_url ?? null,
      ratingAvg: null,
      reviewCount: 0,
    } satisfies SongCardModel
  })
}

export async function getArtistDetail(id: string): Promise<ArtistDetail | null> {
  const client = requireClient()

  const { data, error } = await client
    .from('artists')
    // `*` so this works before and after 0025, which adds the bio and sync
    // columns.
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (error.code === '22P02') return null // bad uuid in the URL
    throw error
  }
  if (!data) return null

  const [albumRes, followers, topSongs] = await Promise.all([
    client
      .from('albums')
      .select('*')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
    client.rpc('artist_follower_count', { target: id }),
    topSongsFor(id),
  ])
  if (albumRes.error) throw albumRes.error

  const all: ArtistAlbum[] = (albumRes.data ?? []).map((row) => {
    const a = row as {
      id: string
      title: string
      cover_url: string | null
      release_date: string | null
      album_type?: string | null
      total_tracks?: number | null
    }
    return {
      id: a.id,
      title: a.title,
      coverUrl: a.cover_url,
      releaseDate: a.release_date,
      year: yearOf(a.release_date),
      albumType: a.album_type ?? null,
      totalTracks: a.total_tracks ?? null,
    }
  })

  const row = data as Record<string, unknown>
  return {
    id: data.id,
    spotifyId: (row.spotify_id as string) ?? null,
    name: data.name,
    imageUrl: data.image_url,
    genres: (data.genres as string[] | null) ?? [],
    bio: (row.bio as string) ?? null,
    bioUrl: (row.bio_url as string) ?? null,
    bioFetchedAt: (row.bio_fetched_at as string) ?? null,
    discographySyncedAt: (row.discography_synced_at as string) ?? null,
    // Missing pre-0025; the page just shows no follower line.
    followerCount: followers.error ? 0 : Number(followers.data ?? 0),
    topSongs,
    // Anything Spotify calls a single or an EP goes in the second tab.
    albums: all.filter((a) => (a.albumType ?? 'album') === 'album'),
    singles: all.filter((a) => (a.albumType ?? 'album') !== 'album'),
  }
}

/* ----------------------------------------------------------- cache fills */

/** True when the discography has never synced, or is more than a day old. */
export function discographyIsStale(syncedAt: string | null) {
  if (!syncedAt) return true
  return Date.now() - new Date(syncedAt).getTime() > SYNC_AFTER_HOURS * 3_600_000
}

/**
 * Fire-and-forget: the page already has whatever was cached, and a refresh
 * landing a moment later is picked up on the next read. Failures are logged
 * rather than surfaced — a stale discography is not an error worth a banner.
 */
export async function syncDiscography(spotifyId: string) {
  const { data, error } = await requireClient().functions.invoke('spotify-artist', {
    body: { action: 'discography', spotifyId },
  })
  if (error) {
    console.warn('[beatboxed] discography sync failed:', error.message)
    return null
  }
  return data as { albums: number; newReleases: number } | null
}

export async function syncArtistBio(spotifyId: string) {
  const { data, error } = await requireClient().functions.invoke('spotify-artist', {
    body: { action: 'bio', spotifyId },
  })
  if (error) {
    console.warn('[beatboxed] bio lookup failed:', error.message)
    return null
  }
  return data as { bio: string | null; url: string | null } | null
}

export async function syncAlbumTracks(spotifyId: string) {
  const { data, error } = await requireClient().functions.invoke('spotify-artist', {
    body: { action: 'album', spotifyId },
  })
  if (error) {
    console.warn('[beatboxed] album sync failed:', error.message)
    return null
  }
  return data as { tracks: number; totalTracks: number | null } | null
}

/* -------------------------------------------------------------- the album */

export async function getAlbumDetail(id: string): Promise<AlbumDetail | null> {
  const client = requireClient()

  const { data, error } = await client
    .from('albums')
    .select('*, artists(id, name)')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  if (!data) return null

  const { data: trackRows, error: trackErr } = await client
    .from('songs')
    .select('id, title, duration_ms, track_number, disc_number, artist_id, artists(name), albums(cover_url)')
    .eq('album_id', id)
    .order('disc_number', { ascending: true, nullsFirst: true })
    .order('track_number', { ascending: true, nullsFirst: true })
  if (trackErr) throw trackErr

  const row = data as Record<string, unknown>
  const owner = one(data.artists as Rel<{ id: string; name: string }>)

  const tracks: AlbumTrack[] = (trackRows ?? []).map((t) => {
    const r = t as unknown as {
      id: string
      title: string
      duration_ms: number | null
      track_number: number | null
      disc_number: number | null
      artist_id: string | null
      artists: Rel<{ name: string }>
      albums: Rel<{ cover_url: string | null }>
    }
    return {
      id: r.id,
      title: r.title,
      artistName: one(r.artists)?.name ?? 'Unknown artist',
      coverUrl: one(r.albums)?.cover_url ?? (data.cover_url as string | null),
      ratingAvg: null,
      reviewCount: 0,
      trackNumber: r.track_number,
      discNumber: r.disc_number,
      durationMs: r.duration_ms,
      artistId: r.artist_id,
    }
  })

  return {
    id: data.id,
    spotifyId: (row.spotify_id as string) ?? null,
    title: data.title,
    coverUrl: data.cover_url,
    releaseDate: data.release_date,
    albumType: (row.album_type as string) ?? null,
    totalTracks: (row.total_tracks as number) ?? null,
    artistId: owner?.id ?? null,
    artistName: owner?.name ?? 'Unknown artist',
    tracks,
  }
}

/** True when Spotify says the album has more tracks than we've cached. */
export function albumIsIncomplete(album: AlbumDetail) {
  if (album.totalTracks == null) return album.tracks.length === 0
  return album.tracks.length < album.totalTracks
}

/**
 * The album id for a song, caching the album first if we've never seen it.
 *
 * Song rows always carry album_id once cached through search, so this is
 * normally a straight read; the fetch path covers songs whose album row
 * exists but was never opened.
 */
export async function albumIdForSong(songId: string): Promise<string | null> {
  const { data, error } = await requireClient()
    .from('songs')
    .select('album_id')
    .eq('id', songId)
    .maybeSingle()
  if (error) throw error
  return data?.album_id ?? null
}
