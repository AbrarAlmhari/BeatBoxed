import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disc3, Play, Users } from 'lucide-react'
import { FollowButton } from '@/components/ui/FollowButton'
import { StarRating } from '@/components/ui/StarRating'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Chip } from '@/components/ui/Chip'
import { fetchArtistGenres, genreLabel } from '@/lib/genres'
import { MEDIA_GRID, SkeletonMediaGrid } from '@/components/ui/Skeleton'
import { Card } from '@/components/ui/Card'
import { EmptyState, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { COVER_FALLBACK, useCoverColors } from '@/lib/coverColors'
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
        // Genres too: looked up the first time anyone opens the page.
        if (!detail.genresFetchedAt) {
          void fetchArtistGenres(detail.id).then(
            (found) => found && !cancelled && setReloadKey((k) => k + 1)
          )
        }

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

  // Hooks before the early returns: the glow follows the photo once known.
  const photoColors = useCoverColors(artist?.imageUrl)

  if (loading && !artist) return <ArtistSkeleton />

  if (failed || !artist) {
    return (
      <EmptyState
        face="sad"
        tone="error"
        title="Couldn't load this artist"
        detail="Check your connection and try again."
        action={
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={emptySecondaryActionClass}>
            Retry
          </button>
        }
      />
    )
  }

  const shown = tab === 'albums' ? artist.albums : artist.singles

  return (
    <div className="relative isolate flex flex-col gap-8 pt-2">
      <header className="relative flex flex-col gap-5 pb-2 sm:flex-row sm:items-end">
        <PageGlow strength="hero" colors={photoColors ?? COVER_FALLBACK} />
        <div className="size-44 shrink-0 self-center overflow-hidden rounded-full shadow-card sm:size-48 sm:self-auto">
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

          {artist.genreBuckets.length > 0 && (
            <ul aria-label="Genres" className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {artist.genreBuckets.map((g) => (
                <li key={g}>
                  <Chip>{genreLabel(g)}</Chip>
                </li>
              ))}
            </ul>
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
          <SectionHeader title="About" />
          <Card>
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
                className="-my-2 inline-flex min-h-11 items-center rounded-button text-button text-accent transition-colors duration-200 ease-soft hover:text-foreground"
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
          </Card>
        </section>
      )}

      {artist.topSongs.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Top songs" />
          <Card as="ol" padding="sm" className="flex flex-col gap-0.5">
            {artist.topSongs.map((song, i) => {
              const isCurrent = player.current?.id === song.id
              return (
                <li
                  key={song.id}
                  className={cn(
'group flex items-center gap-3 rounded-inset px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface-2',
                    isCurrent && 'bg-surface-2'
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
                    className="relative size-11 shrink-0 overflow-hidden rounded-thumb bg-surface-2"
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
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Discography" />

        <Tabs
          tabs={[
            { id: 'albums', label: 'Albums' },
            { id: 'singles', label: 'Singles & EPs' },
          ]}
          value={tab}
          onChange={setTab}
          label="Discography"
          idPrefix="discography"
          fill={false}
        />

        <TabPanel idPrefix="discography" value={tab}>
          {shown.length === 0 ? (
            syncing.current ? (
              <SkeletonMediaGrid count={4} />
            ) : (
              <EmptyState
                face="sleepy"
                compact
                title={
                  tab === 'albums'
                    ? 'No albums cached for this artist yet.'
                    : 'No singles or EPs cached for this artist yet.'
                }
              />
            )
          ) : (
            <div className={MEDIA_GRID}>
              {shown.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          )}
        </TabPanel>
      </section>
    </div>
  )
}

function AlbumCard({ album }: { album: ArtistAlbum }) {
  return (
    <Link
      to={`/album/${album.id}`}
      className="group flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-cover bg-surface-2">
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
    <div className="flex flex-col gap-8 pt-2" aria-busy="true">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Skeleton tone="page" className="size-48 shrink-0 self-center rounded-full sm:size-52 sm:self-auto" />
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
