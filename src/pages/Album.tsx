import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disc3, Pause, Play } from 'lucide-react'
import { AddToPlaylistButton } from '@/components/playlist/AddToPlaylistButton'
import { StarRating } from '@/components/ui/StarRating'
import { Card } from '@/components/ui/Card'
import { EmptyState, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { Skeleton } from '@/components/ui/Skeleton'
import { COVER_FALLBACK, useCoverColors } from '@/lib/coverColors'
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

  // Hooks before the early returns: the glow follows the cover once known.
  const coverColors = useCoverColors(album?.coverUrl)

  if (loading && !album) return <AlbumSkeleton />

  if (failed || !album) {
    return (
      <EmptyState
        face="sad"
        tone="error"
        title="Couldn't load this album"
        action={
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={emptySecondaryActionClass}>
            Retry
          </button>
        }
      />
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
    <div className="relative isolate flex flex-col gap-8 pt-2">
      <header className="relative flex flex-col gap-5 pb-2 sm:flex-row sm:items-end">
        <PageGlow strength="hero" colors={coverColors ?? COVER_FALLBACK} />
        <div className="w-48 shrink-0 self-center sm:w-52 sm:self-auto">
          <div className="relative aspect-square w-full overflow-hidden rounded-card bg-surface-2 shadow-card">
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
              className="flex min-h-11 items-center gap-2 rounded-button bg-primary px-5 text-button text-white transition-all duration-200 ease-soft hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
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
          <Card as="ol" padding="sm" shadow={false} className="flex flex-col gap-0.5" aria-label="Loading tracks">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-4 w-5" />
                <Skeleton className="size-11 shrink-0 rounded-thumb" />
                <Skeleton className="h-4 flex-1" />
              </li>
            ))}
          </Card>
        ) : (
          <EmptyState face="sad" title="No tracks cached" detail="We couldn't load this album's track list." />
        )
      ) : (
        <Card as="ol" padding="sm" className="flex flex-col gap-0.5">
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
'group flex items-center gap-3 rounded-inset px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface-2',
                    isCurrent && 'bg-surface-2'
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
                    className="relative size-11 shrink-0 overflow-hidden rounded-thumb bg-surface-2"
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
        </Card>
      )}
    </div>
  )
}

function AlbumSkeleton() {
  return (
    <div className="flex flex-col gap-8 pt-2" aria-busy="true">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Skeleton tone="page" className="size-48 shrink-0 self-center rounded-cover sm:size-52 sm:self-auto" />
        <div className="flex flex-1 flex-col items-center gap-3 py-2 sm:items-start">
          <Skeleton tone="page" className="h-8 w-2/3" />
          <Skeleton tone="page" className="h-4 w-1/2" />
          <Skeleton tone="page" className="h-11 w-28 rounded-button" />
        </div>
      </div>
      <Card padding="sm" shadow={false} className="flex flex-col gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="size-11 shrink-0 rounded-thumb" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </Card>
    </div>
  )
}
