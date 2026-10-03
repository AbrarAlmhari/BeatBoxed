import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disc3, Loader2, Play, Users } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { FollowButton } from '@/components/ui/FollowButton'
import { StarRating } from '@/components/ui/StarRating'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/cn'
import {
  discographyIsStale,
  getArtistDetail,
  syncArtistBio,
  syncDiscography,
  type ArtistAlbum,
  type ArtistDetail,
} from '@/lib/artists'

type Tab = 'albums' | 'singles'

export default function Artist() {
  const { id = '' } = useParams()
  const player = usePlayer()

  const [artist, setArtist] = useState<ArtistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('albums')
  const [bioOpen, setBioOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /** Guards against a second sync while one is already running. */
  const syncing = useRef(false)

  const load = useCallback(async () => {
    const detail = await getArtistDetail(id)
    if (!detail) {
      setFailed(true)
      return null
    }
    setArtist(detail)
    return detail
  }, [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    load()
      .then(async (detail) => {
        if (cancelled || !detail?.spotifyId) return

        /*
         * Whatever is cached is already on screen. A refresh runs behind it
         * and the page re-reads once it lands, so opening an artist is never
         * blocked on Spotify.
         */
        if (!syncing.current && discographyIsStale(detail.discographySyncedAt)) {
          syncing.current = true
          void syncDiscography(detail.spotifyId)
            .then(() => !cancelled && setReloadKey((k) => k + 1))
            .finally(() => {
              syncing.current = false
            })
        }

        // Looked up once per artist, ever. bio_fetched_at is stamped even on
        // a miss, so an artist with no Wikipedia article isn't re-queried on
        // every visit.
        if (!detail.bioFetchedAt) {
          void syncArtistBio(detail.spotifyId).then(
            () => !cancelled && setReloadKey((k) => k + 1)
          )
        }
      })
      .catch((err) => {
        console.error('[beatboxed] artist page failed:', err)
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, load, reloadKey])

  if (loading && !artist) return <ArtistSkeleton />

  if (failed || !artist) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-16 text-center">
        <p className="text-card-title">Couldn't load this artist</p>
        <p className="max-w-sm text-body text-muted-foreground">
          Check your connection and try again.
        </p>
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

  const shown = tab === 'albums' ? artist.albums : artist.singles

  return (
    <div className="flex flex-col gap-8 pt-2">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-40 shrink-0 self-center overflow-hidden rounded-full sm:self-auto">
          {artist.imageUrl ? (
            <img
              src={artist.imageUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="grid size-full place-items-center bg-surface-2">
              <Disc3 className="size-10 text-muted-foreground" strokeWidth={1.5} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
          <h1 dir="auto" className="text-page-title">
            {artist.name}
          </h1>

          {artist.genres.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {artist.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-muted-foreground"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-secondary text-muted-foreground">
            <Users className="size-4" strokeWidth={1.75} aria-hidden />
            {artist.followerCount}{' '}
            {artist.followerCount === 1 ? 'follower' : 'followers'} on Beatboxed
          </p>

          <FollowButton artistId={artist.id} />
        </div>
      </header>

      {artist.bio && (
        <section className="flex flex-col gap-2">
          <h2 className="text-section-title">About</h2>
          <div className="rounded-card bg-surface p-4 shadow-card">
            <p
              dir="auto"
              className={cn('text-body text-muted-foreground', !bioOpen && 'line-clamp-3')}
            >
              {artist.bio}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setBioOpen((o) => !o)}
                className="rounded-button text-button text-accent transition-colors duration-200 ease-soft hover:text-foreground"
              >
                {bioOpen ? 'Show less' : 'Read more'}
              </button>
              {/* Wikipedia's licence requires attribution with a link. */}
              <a
                href={artist.bioUrl ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="text-meta text-muted-foreground underline underline-offset-2 transition-colors duration-200 ease-soft hover:text-foreground"
              >
                From Wikipedia
              </a>
            </div>
          </div>
        </section>
      )}

      {artist.topSongs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-section-title">Top songs</h2>
          <ol className="flex flex-col gap-1">
            {artist.topSongs.map((song, i) => {
              const isCurrent = player.current?.id === song.id
              return (
                <li
                  key={song.id}
                  className={cn(
                    'group flex items-center gap-3 rounded-card px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface',
                    isCurrent && 'bg-surface'
                  )}
                >
                  <span className="w-5 shrink-0 text-end text-meta text-muted-foreground">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      isCurrent
                        ? player.toggle()
                        : player.playQueue(artist.topSongs, i)
                    }
                    aria-label={`Play ${song.title}`}
                    className="relative size-11 shrink-0 overflow-hidden rounded-[8px] bg-surface-2"
                  >
                    {song.coverUrl && (
                      <img
                        src={song.coverUrl}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                      />
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-200 ease-soft group-hover:opacity-100">
                      <Play className="size-4 fill-white text-white" strokeWidth={2} />
                    </span>
                  </button>

                  <Link
                    to={`/song/${song.id}`}
                    className="min-w-0 flex-1 transition-colors duration-200 ease-soft hover:text-accent"
                  >
                    <span
                      dir="auto"
                      className={cn('block truncate text-card-title', isCurrent && 'text-primary')}
                    >
                      {song.title}
                    </span>
                  </Link>

                  {song.reviewCount > 0 && song.ratingAvg != null && (
                    <span className="flex shrink-0 items-center gap-1">
                      <StarRating value={song.ratingAvg} size={13} />
                      <span className="text-meta text-muted-foreground">
                        {song.ratingAvg.toFixed(1)}
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-section-title">Discography</h2>

        <div className="flex gap-2" role="tablist">
          <Chip active={tab === 'albums'} onClick={() => setTab('albums')}>
            Albums
          </Chip>
          <Chip active={tab === 'singles'} onClick={() => setTab('singles')}>
            Singles &amp; EPs
          </Chip>
        </div>

        {shown.length === 0 ? (
          <div className="flex items-center gap-2 rounded-card bg-surface px-5 py-8 text-body text-muted-foreground">
            {syncing.current && (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            )}
            {tab === 'albums'
              ? 'No albums cached for this artist yet.'
              : 'No singles or EPs cached for this artist yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {shown.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function AlbumCard({ album }: { album: ArtistAlbum }) {
  return (
    <Link
      to={`/album/${album.id}`}
      className="group flex flex-col gap-3 rounded-card bg-surface p-3 shadow-card transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-surface-2">
        {album.coverUrl ? (
          <img
            src={album.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-soft group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <Disc3 className="size-8 text-muted-foreground" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 pb-1">
        <p dir="auto" className="truncate text-card-title">
          {album.title}
        </p>
        <p className="text-secondary text-muted-foreground">{album.year ?? '—'}</p>
      </div>
    </Link>
  )
}

function ArtistSkeleton() {
  return (
    <div className="flex flex-col gap-8 pt-2">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-40 shrink-0 animate-pulse self-center rounded-full bg-surface sm:self-auto" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="h-8 w-56 animate-pulse rounded bg-surface" />
          <div className="h-4 w-40 animate-pulse rounded bg-surface" />
          <div className="h-9 w-28 animate-pulse rounded-button bg-surface" />
        </div>
      </div>
      <div className="h-24 animate-pulse rounded-card bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-card bg-surface p-3">
            <div className="aspect-square w-full animate-pulse rounded-[10px] bg-surface-2" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  )
}
