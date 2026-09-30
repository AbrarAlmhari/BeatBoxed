import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  Disc3,
  Loader2,
  MicVocal,
  SearchX,
} from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { FollowButton } from '@/components/ui/FollowButton'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewsTab } from '@/components/song/ReviewsTab'
import { tintFor } from '@/components/explore/tint'
import {
  getFollowedArtistIds,
  getLyrics,
  getSongDetail,
  getSongRatingStats,
  recordSongView,
} from '@/lib/catalog'
import { useAuth } from '@/lib/auth'
import type { LyricsResult, SongDetail } from '@/lib/types'

type Section = 'about' | 'lyrics' | 'reviews'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'about', label: 'About' },
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

  const [followingArtist, setFollowingArtist] = useState(false)
  const [active, setActive] = useState<Section>('about')
  const aboutRef = useRef<HTMLElement>(null)
  const lyricsRef = useRef<HTMLElement>(null)
  const reviewsRef = useRef<HTMLElement>(null)
  const sectionRefs: Record<Section, React.RefObject<HTMLElement | null>> = {
    about: aboutRef,
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
    if (!user || !song?.artist) return
    let cancelled = false
    getFollowedArtistIds(user.id)
      .then((ids) => {
        if (!cancelled && song.artist) setFollowingArtist(ids.has(song.artist.id))
      })
      .catch((err) => console.warn('[beatboxed] follow state failed:', err))
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
    const els = [aboutRef.current, lyricsRef.current, reviewsRef.current].filter(
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

  const refreshStats = useCallback(() => {
    if (!song) return
    getSongRatingStats(song.id)
      .then(setStats)
      .catch((err) => console.warn('[beatboxed] rating refresh failed:', err))
  }, [song])

  function jumpTo(section: Section) {
    setActive(section)
    sectionRefs[section].current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pt-2">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end">
          <div className="aspect-square w-48 animate-pulse rounded-card bg-surface-2 sm:w-56" />
          <div className="flex w-full flex-col gap-3">
            <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-card bg-surface px-6 py-14 text-center">
        <p className="text-body text-danger">{error}</p>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-16 text-center">
        <SearchX className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="text-card-title">Song not found</p>
        <p className="max-w-sm text-body text-muted-foreground">
          This song isn't in our library. It may have been removed, or the link
          may be wrong.
        </p>
        <Link
          to="/explore"
          className="mt-2 rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95"
        >
          Search for music
        </Link>
      </div>
    )
  }

  const tint = tintFor(song.id)
  const releaseDate = formatReleaseDate(song.album?.releaseDate ?? null)

  const facts: [string, string][] = [
    ['Album', song.album?.title ?? '—'],
    ['Released', releaseDate ?? '—'],
    ['Genre', song.genre ?? 'Not tagged'],
    ['Duration', formatDuration(song.durationMs)],
  ]

  return (
    <div className="flex flex-col gap-8 pt-2">
      <Link
        to="/"
        className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-button px-2 py-1 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        Back
      </Link>

      <header className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
        <div className="aspect-square w-44 shrink-0 overflow-hidden rounded-card shadow-card sm:w-56">
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
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h1 dir="auto" className="text-page-title">
            {song.title}
          </h1>

          {/* No artist page yet, so the name is text — the Follow toggle is
              the real affordance here. */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
            <span dir="auto" className="text-body text-accent">
              {song.artist?.name ?? 'Unknown artist'}
            </span>
            {song.artist && (
              <FollowButton
                artistId={song.artist.id}
                following={followingArtist}
                onChange={setFollowingArtist}
                size="sm"
              />
            )}
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

      {/* Quick-jump nav. Docks under the sticky TopBar (top-0, ~64px tall) and
          sits below it in z-order so the two never overlap awkwardly. */}
      <nav
        aria-label="Jump to section"
        className="no-scrollbar sticky top-16 z-10 -mx-4 flex gap-2 overflow-x-auto border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        {SECTIONS.map((s) => (
          <Chip key={s.id} active={active === s.id} onClick={() => jumpTo(s.id)}>
            {s.label}
          </Chip>
        ))}
      </nav>

      <section id="about" ref={aboutRef} aria-label="About" className="scroll-mt-36">
        <h2 className="mb-4 text-section-title">About</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-card bg-surface p-4 shadow-card">
              <dt className="text-meta text-muted-foreground">{label}</dt>
              <dd dir="auto" className="mt-1 text-card-title capitalize">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="lyrics" ref={lyricsRef} aria-label="Lyrics" className="scroll-mt-36">
        <button
          type="button"
          onClick={() => setLyricsOpen((v) => !v)}
          aria-expanded={lyricsOpen}
          aria-controls="lyrics-panel"
          className="flex w-full items-center justify-between gap-3 rounded-card bg-surface px-5 py-4 text-left shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
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
          <div id="lyrics-panel" className="animate-fade-in mt-3">
            {lyricsLoading ? (
              <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
                <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                Looking up lyrics…
              </div>
            ) : lyrics?.status === 'found' ? (
              <div className="flex flex-col gap-4">
                {lyrics.synced && (
                  <p className="text-meta text-muted-foreground">
                    Timed lyrics are available, but line highlighting needs the
                    player, which isn't built yet.
                  </p>
                )}
                <div className="flex flex-col gap-1.5 rounded-card bg-surface p-5 shadow-card">
                  {lyrics.lines.map((line, i) => (
                    <p key={i} dir="auto" className="text-body">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
                <MicVocal className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <p className="text-card-title">Lyrics not found</p>
                <p className="max-w-sm text-body text-muted-foreground">
                  lrclib doesn't have lyrics for this track yet.
                </p>
              </div>
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
        <h2 className="mb-4 text-section-title">Reviews</h2>
        <ReviewsTab songId={song.id} onStatsChange={refreshStats} />
      </section>
    </div>
  )
}
