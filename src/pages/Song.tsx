import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Disc3, Loader2, MicVocal, SearchX } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewsTab } from '@/components/song/ReviewsTab'
import { tintFor } from '@/components/explore/tint'
import { getLyrics, getSongDetail, getSongReviews, summarise } from '@/lib/catalog'
import type { LyricsResult, ReviewWithAuthor, SongDetail } from '@/lib/types'

type Tab = 'about' | 'lyrics' | 'reviews'

const TABS: { value: Tab; label: string }[] = [
  { value: 'about', label: 'About' },
  { value: 'lyrics', label: 'Lyrics' },
  { value: 'reviews', label: 'Reviews' },
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

  const [song, setSong] = useState<SongDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('about')

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  // Which song we've already requested lyrics for. A state flag can't do this
  // job: setting it re-runs the effect, whose cleanup cancels the in-flight
  // request, so the spinner never clears.
  const lyricsRequestedFor = useRef<string | null>(null)
  const [reviews, setReviews] = useState<ReviewWithAuthor[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSong(null)
    setLyrics(null)
    setReviews(null)
    setTab('about')

    getSongDetail(id)
      .then((s) => {
        if (!cancelled) setSong(s)
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
  }, [id])

  // Lyrics cost an Edge Function round trip, so only fetch when the tab opens.
  useEffect(() => {
    if (tab !== 'lyrics' || !song?.artist) return
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
  }, [tab, song])

  useEffect(() => {
    if (tab !== 'reviews' || !song || reviews) return
    let cancelled = false
    getSongReviews(song.id)
      .then((r) => {
        if (!cancelled) setReviews(r)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] reviews lookup failed:', err)
        if (!cancelled) setReviews([])
      })
    return () => {
      cancelled = true
    }
  }, [tab, song, reviews])

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

  // Once reviews are loaded they are the source of truth for the header, so
  // posting or deleting updates the average without a separate refetch.
  const stats = reviews
    ? summarise(reviews)
    : { ratingAvg: song.ratingAvg, reviewCount: song.reviewCount }

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

          {/* Artist pages aren't built yet — styled as a link, intentionally inert. */}
          <span
            dir="auto"
            role="link"
            aria-disabled="true"
            className="w-fit cursor-pointer text-body text-accent transition-colors duration-200 ease-soft hover:text-foreground"
          >
            {song.artist?.name ?? 'Unknown artist'}
          </span>

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

      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        role="tablist"
        aria-label="Song details"
      >
        {TABS.map((t) => (
          <Chip key={t.value} active={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {tab === 'about' && (
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
      )}

      {tab === 'lyrics' && (
        <section>
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
        </section>
      )}

      {tab === 'reviews' && (
        <ReviewsTab songId={song.id} reviews={reviews} setReviews={setReviews} />
      )}
    </div>
  )
}
