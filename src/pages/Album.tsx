import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disc3, Pause, Play } from 'lucide-react'
import { AddToPlaylistButton } from '@/components/playlist/AddToPlaylistButton'
import { StarRating } from '@/components/ui/StarRating'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/cn'
import { formatDuration, formatTotalDuration } from '@/lib/playlists'
import {
  albumIsIncomplete,
  getAlbumDetail,
  syncAlbumTracks,
  type AlbumDetail,
} from '@/lib/artists'

/** album | single | compilation -> what the header says. */
function albumTypeLabel(type: string | null, trackCount: number) {
  if (type === 'single') return trackCount > 1 ? 'EP' : 'Single'
  if (type === 'compilation') return 'Compilation'
  return 'Album'
}

export default function Album() {
  const { id = '' } = useParams()
  const player = usePlayer()

  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** True while the first fetch of the track list is running. */
  const [fetchingTracks, setFetchingTracks] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const syncing = useRef(false)

  const load = useCallback(() => getAlbumDetail(id), [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    load()
      .then((detail) => {
        if (cancelled) return
        if (!detail) {
          setFailed(true)
          return
        }
        setAlbum(detail)

        /*
         * An album is never shown half-empty: if Spotify's total_tracks is
         * higher than what we've cached, fetch the rest. Also covers the
         * first open of an album we only know from a search result.
         */
        if (!syncing.current && detail.spotifyId && albumIsIncomplete(detail)) {
          syncing.current = true
          setFetchingTracks(detail.tracks.length === 0)
          void syncAlbumTracks(detail.spotifyId)
            .then(() => !cancelled && setReloadKey((k) => k + 1))
            .finally(() => {
              syncing.current = false
              if (!cancelled) setFetchingTracks(false)
            })
        }
      })
      .catch((err) => {
        console.error('[beatboxed] album page failed:', err)
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, load, reloadKey])

  if (loading && !album) return <AlbumSkeleton />

  if (failed || !album) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-16 text-center">
        <p className="text-card-title">Couldn't load this album</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-1 rounded-button bg-surface-2 px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Retry
        </button>
      </div>
    )
  }

  const tracks = album.tracks
  const total = formatTotalDuration(
    tracks.map((t) => ({ ...t, position: 0, durationMs: t.durationMs }))
  )
  const playingThis = tracks.some((t) => t.id === player.current?.id)
  const year = album.releaseDate ? album.releaseDate.slice(0, 4) : null
  const multiDisc = new Set(tracks.map((t) => t.discNumber ?? 1)).size > 1

  return (
    <div className="flex flex-col gap-8 pt-2">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="w-40 shrink-0 self-center sm:self-auto">
          <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-surface-2">
            {album.coverUrl ? (
              <img src={album.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center">
                <Disc3 className="size-10 text-muted-foreground" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 dir="auto" className="text-page-title">
            {album.title}
          </h1>

          <p className="text-secondary text-muted-foreground">
            {album.artistId ? (
              <Link
                to={`/artist/${album.artistId}`}
                className="text-accent transition-colors duration-200 ease-soft hover:text-foreground"
              >
                {album.artistName}
              </Link>
            ) : (
              album.artistName
            )}
            {' · '}
            {albumTypeLabel(album.albumType, album.totalTracks ?? tracks.length)}
            {year && ` · ${year}`}
            {' · '}
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            {total && ` · ${total}`}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() =>
                playingThis && player.isPlaying
                  ? player.toggle()
                  : player.playQueue(tracks, 0)
              }
              className="flex items-center gap-2 rounded-button bg-primary px-4 py-2 text-button text-white transition-all duration-200 ease-soft hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
            >
              {playingThis && player.isPlaying ? (
                <>
                  <Pause className="size-4" strokeWidth={2} aria-hidden />
                  Pause
                </>
              ) : (
                <>
                  <Play className="size-4 fill-current" strokeWidth={2} aria-hidden />
                  Play
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {tracks.length === 0 ? (
        fetchingTracks ? (
          // Loading rows rather than an empty list while the first fetch runs.
          <ol className="flex flex-col gap-1" aria-label="Loading tracks">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <span className="h-4 w-5 animate-pulse rounded bg-surface" />
                <span className="size-11 shrink-0 animate-pulse rounded-[8px] bg-surface" />
                <span className="h-4 flex-1 animate-pulse rounded bg-surface" />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-card bg-surface px-6 py-12 text-center">
            <p className="text-card-title">No tracks cached</p>
            <p className="mt-2 text-body text-muted-foreground">
              We couldn't load this album's track list.
            </p>
          </div>
        )
      ) : (
        <ol className="flex flex-col gap-1">
          {tracks.map((track, i) => {
            const isCurrent = player.current?.id === track.id
            const disc = track.discNumber ?? 1
            const startsDisc =
              multiDisc && (i === 0 || (tracks[i - 1].discNumber ?? 1) !== disc)
            // Only worth naming when it isn't simply the album's artist.
            const showsArtist = track.artistName !== album.artistName

            return (
              <li key={track.id}>
                {startsDisc && (
                  <p className="px-2 pb-1 pt-4 text-meta uppercase tracking-wide text-muted-foreground">
                    Disc {disc}
                  </p>
                )}

                <div
                  className={cn(
                    'group flex items-center gap-3 rounded-card px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface',
                    isCurrent && 'bg-surface'
                  )}
                >
                  <span className="w-6 shrink-0 text-end text-meta text-muted-foreground">
                    {track.trackNumber ?? i + 1}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      isCurrent ? player.toggle() : player.playQueue(tracks, i)
                    }
                    aria-label={
                      isCurrent && player.isPlaying
                        ? `Pause ${track.title}`
                        : `Play ${track.title}`
                    }
                    className="relative size-11 shrink-0 overflow-hidden rounded-[8px] bg-surface-2"
                  >
                    {track.coverUrl && (
                      <img
                        src={track.coverUrl}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                      />
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-200 ease-soft group-hover:opacity-100">
                      {isCurrent && player.isPlaying ? (
                        <Pause className="size-4 text-white" strokeWidth={2} />
                      ) : (
                        <Play className="size-4 fill-white text-white" strokeWidth={2} />
                      )}
                    </span>
                  </button>

                  <Link
                    to={`/song/${track.id}`}
                    className="min-w-0 flex-1 transition-colors duration-200 ease-soft hover:text-accent"
                  >
                    <span
                      dir="auto"
                      className={cn(
                        'block truncate text-card-title',
                        isCurrent && 'text-primary'
                      )}
                    >
                      {track.title}
                    </span>
                    {showsArtist && (
                      <span
                        dir="auto"
                        className="block truncate text-secondary text-muted-foreground"
                      >
                        {track.artistName}
                      </span>
                    )}
                  </Link>

                  {track.reviewCount > 0 && track.ratingAvg != null && (
                    <span className="hidden shrink-0 items-center gap-1 sm:flex">
                      <StarRating value={track.ratingAvg} size={13} />
                      <span className="text-meta text-muted-foreground">
                        {track.ratingAvg.toFixed(1)}
                      </span>
                    </span>
                  )}

                  <span className="shrink-0 text-meta text-muted-foreground">
                    {formatDuration(track.durationMs)}
                  </span>

                  <AddToPlaylistButton songId={track.id} variant="subtle" />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function AlbumSkeleton() {
  return (
    <div className="flex flex-col gap-8 pt-2">
      <div className="flex gap-5">
        <div className="size-40 animate-pulse rounded-[10px] bg-surface" />
        <div className="flex flex-1 flex-col gap-3 py-2">
          <div className="h-8 w-2/3 animate-pulse rounded bg-surface" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface" />
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-card bg-surface" />
    </div>
  )
}
