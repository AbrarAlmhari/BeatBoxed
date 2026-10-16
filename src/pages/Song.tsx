import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Disc3, Heart, Loader2, Pause, Play } from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { usePlayer } from '@/lib/player'
import { Card, cardClass } from '@/components/ui/Card'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { tabClass, useStuck } from '@/components/ui/Tabs'
import { COVER_FALLBACK, useCoverColors } from '@/lib/coverColors'
import { FollowButton } from '@/components/ui/FollowButton'
import { AddToPlaylistButton } from '@/components/playlist/AddToPlaylistButton'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewsTab } from '@/components/song/ReviewsTab'
import { BeatieCard } from '@/components/beatie/BeatieCard'
import { LyricsView } from '@/components/beatie/LyricsView'
import { tintFor } from '@/components/explore/tint'
import {
  getLyrics,
  getSongDetail,
  getSongRatingStats,
  isSongLiked,
  recordSongView,
  setSongLike,
} from '@/lib/catalog'
import { useAuth } from '@/lib/auth'
import type { LyricsResult, SongDetail } from '@/lib/types'

type Section = 'about' | 'beatie' | 'lyrics' | 'reviews'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'beatie', label: 'Beatie' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'reviews', label: 'Reviews' },
]

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatReleaseDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

export default function Song() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const player = usePlayer()
  const navigate = useNavigate()
  const location = useLocation()
  // Notification deep links land here: /song/:id?review=…&comment=…, plus
  // &reply=1 from a notification's Reply button (the box opens ready).
  const [searchParams] = useSearchParams()
  const targetReviewId = searchParams.get('review')
  const targetCommentId = searchParams.get('comment')
  const replyToTarget = searchParams.get('reply') === '1'

  const [song, setSong] = useState<SongDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{
    ratingAvg: number | null
    reviewCount: number
  }>({ ratingAvg: null, reviewCount: 0 })

  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  // Which song we've already requested lyrics for. A state flag can't do this
  // job: setting it re-runs the effect, whose cleanup cancels the in-flight
  // request, so the spinner never clears.
  const lyricsRequestedFor = useRef<string | null>(null)

  const [liked, setLiked] = useState(false)
  const [active, setActive] = useState<Section>('about')
  const aboutRef = useRef<HTMLElement>(null)
  const beatieRef = useRef<HTMLElement>(null)
  const lyricsRef = useRef<HTMLElement>(null)
  const reviewsRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const navStuck = useStuck(navRef, Boolean(song))
  // The header's glow takes the cover's colours (purple until known).
  const coverColors = useCoverColors(song?.album?.coverUrl)
  const sectionRefs: Record<Section, React.RefObject<HTMLElement | null>> = {
    about: aboutRef,
    beatie: beatieRef,
    lyrics: lyricsRef,
    reviews: reviewsRef,
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSong(null)
    setLyrics(null)
    setLyricsOpen(false)
    setActive('about')

    getSongDetail(id)
      .then((s) => {
        if (cancelled) return
        setSong(s)
        if (s) {
          setStats({ ratingAvg: s.ratingAvg, reviewCount: s.reviewCount })
          // Seeds Home's For You rail. Fire-and-forget: a failed write must
          // never stop the page rendering.
          if (user) void recordSongView(s.id, user.id)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[beatboxed] song lookup failed:', err)
        setError("Couldn't load this song. Check your connection and retry.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, user])

  useEffect(() => {
    if (!user || !song) return setLiked(false)
    let cancelled = false
    isSongLiked(user.id, song.id)
      .then((v) => {
        if (!cancelled) setLiked(v)
      })
      .catch((err) => console.warn('[beatboxed] like state failed:', err))
    return () => {
      cancelled = true
    }
  }, [user, song])

  // Lyrics cost an Edge Function round trip, so fetch on first expand only.
  // The result stays in state, so collapsing and reopening doesn't refetch.
  useEffect(() => {
    if (!lyricsOpen || !song?.artist) return
    if (lyricsRequestedFor.current === song.id) return
    lyricsRequestedFor.current = song.id

    let cancelled = false
    setLyricsLoading(true)
    getLyrics(song.artist.name, song.title)
      .then((r) => {
        if (!cancelled) setLyrics(r)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] lyrics lookup failed:', err)
        if (!cancelled) setLyrics({ status: 'empty' })
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lyricsOpen, song])

  // Scroll-spy. The top inset clears the sticky TopBar (~64px) plus the chip
  // rail; the bottom inset keeps the "active" band in the upper viewport so a
  // section lights up as it arrives rather than when it fills the screen.
  useEffect(() => {
    if (!song) return
    const els = [aboutRef.current, beatieRef.current, lyricsRef.current, reviewsRef.current].filter(
      (el): el is HTMLElement => Boolean(el)
    )
    if (els.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id as Section)
      },
      { rootMargin: '-136px 0px -55% 0px', threshold: 0 }
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [song])

  // Now Playing's "Ask Beatie" lands on /song/:id#beatie: go straight to
  // the card once the page has rendered it.
  useEffect(() => {
    if (!song || location.hash !== '#beatie') return
    const t = setTimeout(() => {
      setActive('beatie')
      beatieRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => clearTimeout(t)
  }, [song, location.hash])

  const refreshStats = useCallback(() => {
    if (!song) return
    getSongRatingStats(song.id)
      .then(setStats)
      .catch((err) => console.warn('[beatboxed] rating refresh failed:', err))
  }, [song])

  async function toggleLike() {
    if (!song) return
    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }
    const next = !liked
    setLiked(next)
    try {
      await setSongLike(user.id, song.id, next)
    } catch (err) {
      console.error('[beatboxed] song like failed:', err)
      setLiked(!next)
    }
  }

  function jumpTo(section: Section) {
    setActive(section)
    sectionRefs[section].current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pt-2" aria-busy="true">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end">
          <Skeleton tone="page" className="aspect-square w-52 rounded-card sm:w-56" />
          <div className="flex w-full flex-col items-center gap-3 sm:items-start">
            <Skeleton tone="page" className="h-8 w-2/3" />
            <Skeleton tone="page" className="h-4 w-1/3" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        face="sad"
        tone="error"
        title={error}
        action={
          <button type="button" onClick={() => window.location.reload()} className={emptySecondaryActionClass}>
            Retry
          </button>
        }
      />
    )
  }

  if (!song) {
    return (
      <EmptyState
        face="thinking-sticker"
        title="Song not found"
        detail="This song isn't in our library. It may have been removed, or the link may be wrong."
        action={
          <Link to="/explore" className={emptyActionClass}>
            Search for music
          </Link>
        }
      />
    )
  }

  const isCurrent = player.current?.id === song.id
  const tint = tintFor(song.id)
  const releaseDate = formatReleaseDate(song.album?.releaseDate ?? null)

  const facts: [string, string, string | null][] = [
    ['Album', song.album?.title ?? '—', song.album?.id ?? null],
    ['Released', releaseDate ?? '—', null],
    ['Duration', formatDuration(song.durationMs), null],
  ]

  return (
    <div className="relative isolate flex flex-col gap-8 pt-2">
      <header className="relative flex flex-col items-center gap-5 pb-2 text-center sm:flex-row sm:items-end sm:text-left">
        <PageGlow strength="hero" colors={coverColors ?? COVER_FALLBACK} />
        {/* Wrapped in the album link when there's an album to open. */}
        <AlbumLink albumId={song.album?.id ?? null} className="aspect-square w-52 shrink-0 overflow-hidden rounded-card shadow-card sm:w-56">
          {song.album?.coverUrl ? (
            <img
              src={song.album.coverUrl}
              alt={song.album.title}
              className="size-full object-cover"
            />
          ) : (
            <div
              className="grid size-full place-items-center"
              style={{
                background: `linear-gradient(135deg,
                  color-mix(in oklab, var(--color-primary) ${20 + tint * 55}%, var(--color-surface-2)),
                  color-mix(in oklab, var(--color-accent) ${12 + tint * 40}%, var(--color-background)))`,
              }}
            >
              <Disc3 className="size-10 text-white/70" strokeWidth={1.5} />
            </div>
          )}
        </AlbumLink>

        <div className="flex min-w-0 flex-col gap-2">
          <h1 dir="auto" className="text-page-title">
            {song.title}
          </h1>

          {/* No artist page yet, so the name is text — the Follow toggle is
              the real affordance here. */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
            {song.artist ? (
              <Link
                to={`/artist/${song.artist.id}`}
                dir="auto"
                className="text-body text-accent transition-colors duration-200 ease-soft hover:text-foreground"
              >
                {song.artist.name}
              </Link>
            ) : (
              <span dir="auto" className="text-body text-accent">
                Unknown artist
              </span>
            )}
            {song.artist && (
              <FollowButton artistId={song.artist.id} size="sm" />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {/* The main action on this page, so it gets the primary style. */}
            <button
              type="button"
              onClick={() =>
                isCurrent
                  ? player.toggle()
                  : player.playQueue(
                      [
                        {
                          id: song.id,
                          title: song.title,
                          artistName: song.artist?.name ?? 'Unknown artist',
                          coverUrl: song.album?.coverUrl ?? null,
                          ratingAvg: stats.ratingAvg,
                          reviewCount: stats.reviewCount,
                          spotifyId: song.spotifyId,
                        },
                      ],
                      0
                    )
              }
              disabled={isCurrent && player.unavailable}
              aria-label={isCurrent && player.isPlaying ? 'Pause' : 'Play preview'}
              className="flex min-h-11 items-center gap-2 rounded-button bg-primary px-5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98] disabled:opacity-50 disabled:hover:bg-primary"
            >
              {isCurrent && player.loading ? (
                <Loader2 className="size-[18px] animate-spin" strokeWidth={2.5} aria-hidden />
              ) : isCurrent && player.isPlaying ? (
                <Pause className="size-[18px] fill-current" strokeWidth={2} />
              ) : (
                <Play className="size-[18px] translate-x-px fill-current" strokeWidth={2} />
              )}
              {isCurrent && player.isPlaying ? 'Pause' : 'Play'}
            </button>

            {isCurrent && player.unavailable && (
              <span className="text-meta text-danger">Preview unavailable</span>
            )}

            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={liked}
              aria-label={liked ? 'Remove from liked songs' : 'Add to liked songs'}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-button border px-3.5 text-button transition-colors duration-200 ease-soft active:scale-[0.97]',
                liked
                  ? 'border-primary/60 bg-primary/15 text-foreground'
                  : 'border-line-strong bg-surface-2 text-muted-foreground hover:text-foreground'
              )}
            >
              <Heart
                className={cn('size-4', liked && 'fill-primary text-primary')}
                strokeWidth={1.75}
              />
              {liked ? 'Liked' : 'Like'}
            </button>

            <AddToPlaylistButton songId={song.id} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {stats.reviewCount > 0 && stats.ratingAvg != null ? (
              <>
                <StarRating value={stats.ratingAvg} size={17} />
                <span className="text-secondary text-foreground">
                  {stats.ratingAvg.toFixed(1)}
                </span>
                <span className="text-secondary text-muted-foreground">
                  ({stats.reviewCount}{' '}
                  {stats.reviewCount === 1 ? 'review' : 'reviews'})
                </span>
              </>
            ) : (
              <span className="text-secondary text-muted-foreground">
                No ratings yet
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Quick-jump nav. Docks under the sticky TopBar (~64px tall) and sits
          below it in z-order. It looks like the shared tabs but stays a set
          of jump links: every section is on the page at once. The glass
          background only shows once it's stuck. */}
      <nav
        ref={navRef}
        aria-label="Jump to section"
        className={cn(
          'no-scrollbar sticky top-16 z-10 -mx-4 flex overflow-x-auto border-b border-line-strong px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
          navStuck && 'glass-bar'
        )}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpTo(s.id)}
            aria-current={active === s.id ? 'true' : undefined}
            className={tabClass(active === s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <section id="about" ref={aboutRef} aria-label="About" className="scroll-mt-36">
        <SectionHeader title="About" className="mb-4" />
        <Card padding="none">
          <dl className="grid grid-cols-3 divide-x divide-line">
          {facts.map(([label, value, albumId]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 px-3 py-4 sm:px-5">
              <dt className="text-meta text-muted-foreground">{label}</dt>
              <dd dir="auto" className="break-words text-card-title">
                {albumId ? (
                  <Link
                    to={`/album/${albumId}`}
                    className="text-accent transition-colors duration-200 ease-soft hover:text-foreground"
                  >
                    {value}
                  </Link>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
          </dl>
        </Card>
      </section>

      <section id="beatie" ref={beatieRef} aria-label="Beatie" className="scroll-mt-36">
        <BeatieCard songId={song.id} />
      </section>

      <section id="lyrics" ref={lyricsRef} aria-label="Lyrics" className="scroll-mt-36">
        <button
          type="button"
          onClick={() => setLyricsOpen((v) => !v)}
          aria-expanded={lyricsOpen}
          aria-controls="lyrics-panel"
          className={cn(
            cardClass({ padding: 'none', interactive: true }),
            'flex min-h-14 w-full items-center justify-between gap-3 px-5 py-4 text-left'
          )}
        >
          <span className="text-section-title">Lyrics</span>
          <ChevronDown
            className={`size-5 shrink-0 text-muted-foreground transition-transform duration-200 ease-soft ${
              lyricsOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={2}
            aria-hidden
          />
        </button>

        {lyricsOpen && (
          <div id="lyrics-panel" className="animate-fade-in mt-3 motion-reduce:animate-none">
            {lyricsLoading ? (
              <Card role="status" className="flex flex-col gap-3">
                <span className="sr-only">Looking up lyrics…</span>
                {[90, 70, 80, 55, 75].map((w, i) => (
                  <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
                ))}
              </Card>
            ) : lyrics?.status === 'found' ? (
              <div className="flex flex-col gap-4">
                {lyrics.synced && (
                  <p className="text-meta text-muted-foreground">
                    Timed lyrics are available, but line highlighting needs the
                    player, which isn't built yet.
                  </p>
                )}
                <LyricsView songId={song.id} lines={lyrics.lines} />
              </div>
            ) : (
              <EmptyState
                face="sad"
                title="Lyrics not found"
                detail="lrclib doesn't have lyrics for this track yet."
              />
            )}
          </div>
        )}
      </section>

      <section
        id="reviews"
        ref={reviewsRef}
        aria-label="Reviews"
        className="scroll-mt-36 pb-4"
      >
        <SectionHeader title="Reviews" className="mb-4" />
        <ReviewsTab
          songId={song.id}
          onStatsChange={refreshStats}
          targetReviewId={targetReviewId}
          targetCommentId={targetCommentId}
          replyToTarget={replyToTarget}
          song={{
            id: song.id,
            title: song.title,
            artistName: song.artist?.name ?? '',
            coverUrl: song.album?.coverUrl ?? null,
          }}
        />
      </section>
    </div>
  )
}

/**
 * The cover, as a link to the album when there is one.
 *
 * An album row always exists for a song cached from search, so this is
 * normally a link; the album's own page fetches its track list on open, so
 * "not cached yet" means an album page that fills itself in, not a dead
 * link. A song with no album at all stays a plain div rather than a link to
 * nowhere.
 */
function AlbumLink({
  albumId,
  className,
  children,
}: {
  albumId: string | null
  className?: string
  children: React.ReactNode
}) {
  if (!albumId) return <div className={className}>{children}</div>
  return (
    <Link to={`/album/${albumId}`} aria-label="Open album" className={className}>
      {children}
    </Link>
  )
}
