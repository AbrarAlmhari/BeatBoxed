import { supabase } from './supabase'
import { prepareCover } from './image'
import type { SongCardModel } from './types'

/**
 * Everything the playlist screens read and write.
 *
 * Kept out of catalog.ts: that file is the shared read layer for Home and
 * Explore, and these are owner-scoped writes with their own shape.
 *
 * Note on updated_at: the column is maintained by a database trigger
 * (0019_playlists.sql) and deliberately never read or written here, so these
 * screens work identically on a database where that migration hasn't been
 * applied yet. Ordering is by created_at for the same reason.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/** PostgREST returns an object for a many-to-one embed; supabase-js says array. */
type Rel<T> = T | T[] | null
const one = <T,>(v: Rel<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

/** Where a custom cover lives. The user id leads, because that's what the
 *  storage policies check; the playlist id is the filename. */
const COVER_BUCKET = 'playlist-covers'
const coverPath = (userId: string, playlistId: string, ext: string) =>
  `${userId}/${playlistId}.${ext}`
/** Both possible extensions, since the encoder picks one at upload time. */
const COVER_EXTENSIONS = ['webp', 'jpg']

export type PlaylistSort = 'recent' | 'az' | 'songs'

export type PlaylistSummary = {
  id: string
  title: string
  description: string | null
  ownerId: string
  /** updated_at where 0019 has been applied, created_at otherwise. */
  sortedAt: string
  /** A custom upload, or null to fall back to the artwork grid. */
  coverUrl: string | null
  songCount: number
  /** Up to four covers, in playlist order, for the mosaic. */
  coverUrls: string[]
}

export type PlaylistTrack = SongCardModel & {
  position: number
  durationMs: number | null
}

export type PlaylistDetail = {
  id: string
  title: string
  description: string | null
  ownerId: string
  ownerName: string
  coverUrl: string | null
  songs: PlaylistTrack[]
}

const SONG_FIELDS =
  'id, title, duration_ms, artists(name), albums(cover_url)'

type SongRow = {
  id: string
  title: string
  duration_ms: number | null
  artists: Rel<{ name: string }>
  albums: Rel<{ cover_url: string | null }>
}

function toTrack(row: SongRow, position: number): PlaylistTrack {
  return {
    id: row.id,
    title: row.title,
    artistName: one(row.artists)?.name ?? 'Unknown artist',
    coverUrl: one(row.albums)?.cover_url ?? null,
    ratingAvg: null,
    reviewCount: 0,
    position,
    durationMs: row.duration_ms,
  }
}

/** mm:ss, or an em dash when the catalog has no duration for a song. */
export function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Total runtime as "1 hr 4 min" / "12 min", for the detail header. */
export function formatTotalDuration(tracks: PlaylistTrack[]) {
  const ms = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0)
  if (ms <= 0) return null
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ${minutes % 60} min`
}

/**
 * One person's playlists, newest first, each with its song count and the
 * first few covers for the mosaic.
 *
 * Two queries rather than one per playlist: the covers for every playlist
 * come back together and are grouped here, so a profile with ten playlists
 * still costs two round trips.
 */
export async function getUserPlaylists(
  userId: string
): Promise<PlaylistSummary[]> {
  const client = requireClient()

  // `*` rather than a column list so this works either side of 0019, which
  // adds updated_at.
  const { data: lists, error } = await client
    .from('playlists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const ids = (lists ?? []).map((l) => l.id)
  if (ids.length === 0) return []

  const { data: entries, error: songErr } = await client
    .from('playlist_songs')
    .select('playlist_id, position, songs(albums(cover_url))')
    .in('playlist_id', ids)
    .order('position', { ascending: true })
  if (songErr) throw songErr

  const counts = new Map<string, number>()
  const covers = new Map<string, string[]>()
  for (const row of (entries ?? []) as unknown as {
    playlist_id: string
    songs: Rel<{ albums: Rel<{ cover_url: string | null }> }>
  }[]) {
    counts.set(row.playlist_id, (counts.get(row.playlist_id) ?? 0) + 1)
    const cover = one(one(row.songs)?.albums)?.cover_url
    if (!cover) continue
    const list = covers.get(row.playlist_id) ?? []
    if (list.length < 4) list.push(cover)
    covers.set(row.playlist_id, list)
  }

  return (lists ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    ownerId: l.user_id,
    coverUrl: l.cover_url,
    sortedAt: (l as { updated_at?: string }).updated_at ?? l.created_at,
    songCount: counts.get(l.id) ?? 0,
    coverUrls: covers.get(l.id) ?? [],
  }))
}

/**
 * One page of a person's playlists, sorted across the whole list.
 *
 * The full set is read and sorted here rather than in Postgres. Two reasons:
 * "most songs" can't be ordered by PostgREST without an aggregate view, and
 * the song counts and cover art need every playlist_songs row for these
 * playlists anyway — so paging in the database would cost the same two
 * queries and then sort a slice instead of the list. People have tens of
 * playlists, not thousands.
 *
 * limit/offset are kept so the page behaves like the other full lists.
 */
export async function getUserPlaylistsPage(
  userId: string,
  opts: { limit?: number; offset?: number; sort?: PlaylistSort } = {}
): Promise<PlaylistSummary[]> {
  const { limit = 30, offset = 0, sort = 'recent' } = opts
  const all = await getUserPlaylists(userId)

  const sorted = [...all].sort((a, b) => {
    if (sort === 'az') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    }
    if (sort === 'songs') {
      // Equal counts keep the recent order, so the list doesn't shuffle
      // arbitrarily between renders.
      return b.songCount - a.songCount || (a.sortedAt < b.sortedAt ? 1 : -1)
    }
    return a.sortedAt < b.sortedAt ? 1 : -1
  })

  return sorted.slice(offset, offset + limit)
}

/**
 * How many playlists someone has, including when RLS hides the rows.
 *
 * A private profile still shows its counts to a non-friend, so this goes
 * through the security definer playlist_count() for the same reason the
 * review and friend counts do.
 */
export async function getPlaylistCount(userId: string): Promise<number> {
  const { data, error } = await requireClient().rpc('playlist_count', {
    target: userId,
  })
  if (error) {
    // pre-0023: fall back to what this viewer can actually see. Correct for
    // a public profile, and 0 for a private one until the migration lands.
    if (error.code === 'PGRST202') return (await getUserPlaylists(userId)).length
    throw error
  }
  return Number(data ?? 0)
}

/** Null when the playlist doesn't exist (or a signed-out user asks). */
export async function getPlaylist(id: string): Promise<PlaylistDetail | null> {
  const client = requireClient()

  const { data: list, error } = await client
    .from('playlists')
    .select('id, title, description, user_id, cover_url, profiles(display_name, username)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!list) return null

  const { data: entries, error: songErr } = await client
    .from('playlist_songs')
    .select(`position, songs(${SONG_FIELDS})`)
    .eq('playlist_id', id)
    .order('position', { ascending: true })
  if (songErr) throw songErr

  const owner = one(
    list.profiles as Rel<{ display_name: string | null; username: string | null }>
  )

  const songs: PlaylistTrack[] = []
  for (const row of (entries ?? []) as unknown as {
    position: number
    songs: Rel<SongRow>
  }[]) {
    const song = one(row.songs)
    if (song) songs.push(toTrack(song, row.position))
  }

  return {
    id: list.id,
    title: list.title,
    description: list.description,
    ownerId: list.user_id,
    coverUrl: list.cover_url,
    ownerName: owner?.display_name || owner?.username || 'Unknown listener',
    songs,
  }
}

export async function createPlaylist(
  userId: string,
  title: string,
  description: string
): Promise<PlaylistSummary> {
  const { data, error } = await requireClient()
    .from('playlists')
    .insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
    })
    .select('id, title, description, user_id, cover_url')
    .single()
  if (error) throw error
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    ownerId: data.user_id,
    coverUrl: data.cover_url,
    sortedAt: new Date().toISOString(),
    songCount: 0,
    coverUrls: [],
  }
}

export async function updatePlaylist(
  id: string,
  fields: { title: string; description: string }
) {
  const { error } = await requireClient()
    .from('playlists')
    .update({
      title: fields.title.trim(),
      description: fields.description.trim() || null,
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Removes the playlist and its custom cover. The songs go by cascade; the
 * file in storage doesn't, so it's cleared here or it would be orphaned for
 * good once the row naming it is gone.
 */
export async function deletePlaylist(id: string, ownerId?: string) {
  if (ownerId) await deleteCoverFiles(ownerId, id)
  const { error } = await requireClient().from('playlists').delete().eq('id', id)
  if (error) throw error
}

/** Best-effort: a cover that won't delete must not block the real work. */
async function deleteCoverFiles(userId: string, playlistId: string) {
  const { error } = await requireClient()
    .storage.from(COVER_BUCKET)
    .remove(COVER_EXTENSIONS.map((ext) => coverPath(userId, playlistId, ext)))
  if (error) console.warn('[beatboxed] could not remove cover:', error.message)
}

/**
 * Squares, shrinks and uploads a cover, then stores its public URL.
 *
 * upsert, so replacing a cover overwrites the same object rather than
 * leaving the old one behind. The URL carries a ?v= stamp because the path
 * doesn't change between uploads and the CDN would otherwise keep serving
 * the previous image.
 */
export async function uploadPlaylistCover(
  userId: string,
  playlistId: string,
  file: File
) {
  const client = requireClient()
  const { blob, contentType, extension } = await prepareCover(file)
  const path = coverPath(userId, playlistId, extension)

  const { error } = await client.storage
    .from(COVER_BUCKET)
    .upload(path, blob, { upsert: true, contentType })
  if (error) throw error

  const { data } = client.storage.from(COVER_BUCKET).getPublicUrl(path)
  const url = `${data.publicUrl}?v=${Date.now()}`

  const { error: saveErr } = await client
    .from('playlists')
    .update({ cover_url: url })
    .eq('id', playlistId)
  if (saveErr) throw saveErr

  return url
}

/** Drops the custom cover so the automatic artwork grid comes back. */
export async function removePlaylistCover(userId: string, playlistId: string) {
  await deleteCoverFiles(userId, playlistId)
  const { error } = await requireClient()
    .from('playlists')
    .update({ cover_url: null })
    .eq('id', playlistId)
  if (error) throw error
}

/** Already-present is success, not an error — the song ends up in the list either way. */
export async function addSongToPlaylist(playlistId: string, songId: string) {
  const client = requireClient()

  const { data: last, error: posErr } = await client
    .from('playlist_songs')
    .select('position')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })
    .limit(1)
  if (posErr) throw posErr

  const position = (last?.[0]?.position ?? -1) + 1
  const { error } = await client
    .from('playlist_songs')
    .insert({ playlist_id: playlistId, song_id: songId, position })

  // 23505: the (playlist_id, song_id) primary key already holds this song.
  if (error && error.code !== '23505') throw error
  return { added: !error }
}

export async function removeSongFromPlaylist(
  playlistId: string,
  songId: string
) {
  const { error } = await requireClient()
    .from('playlist_songs')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('song_id', songId)
  if (error) throw error
}

/**
 * Rewrites positions to match the given order, in one request.
 *
 * Upsert on the primary key, so it's an update of position for rows that are
 * already there. There's no unique constraint on (playlist_id, position), so
 * a reorder doesn't need a two-phase shuffle to avoid collisions mid-write.
 */
export async function setPlaylistOrder(playlistId: string, songIds: string[]) {
  if (songIds.length === 0) return
  const { error } = await requireClient()
    .from('playlist_songs')
    .upsert(
      songIds.map((songId, position) => ({
        playlist_id: playlistId,
        song_id: songId,
        position,
      })),
      { onConflict: 'playlist_id,song_id' }
    )
  if (error) throw error
}

/** Which of this user's playlists already hold a given song. */
export async function getPlaylistsContaining(
  userId: string,
  songId: string
): Promise<Set<string>> {
  const { data, error } = await requireClient()
    .from('playlist_songs')
    .select('playlist_id, playlists!inner(user_id)')
    .eq('song_id', songId)
    .eq('playlists.user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.playlist_id))
}
