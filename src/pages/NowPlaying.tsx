import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Disc3,
  ExternalLink,
  Heart,
  Loader2,
  MicVocal,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { usePlayer } from '@/lib/player'
import { useAuth } from '@/lib/auth'
import { getLyrics, isSongLiked, setSongLike } from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { LyricsResult } from '@/lib/types'

function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function NowPlaying() {
  const { user } = useAuth()
  const {
    current,
    isPlaying,
    loading,
    unavailable,
    position,
    duration,
    toggle,
    next,
    previous,
    seek,
  } = usePlayer()

  const [tab, setTab] = useState<'artwork' | 'lyrics'>('artwork')
  const [liked, setLiked] = useState(false)
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)

  useEffect(() => {
    if (!user || !current) return setLiked(false)
    let cancelled = false
    isSongLiked(user.id, current.id)
      .then((v) => {
        if (!cancelled) setLiked(v)
      })
      .catch((err) => console.warn('[beatboxed] like state failed:', err))
    return () => {
      cancelled = true
    }
  }, [user, current])

  // Lyrics cost an Edge Function call, so only when the tab is opened.
  useEffect(() => {
    if (tab !== 'lyrics' || !current || lyrics) return
    let cancelled = false
    setLyricsLoading(true)
    getLyrics(current.artistName, current.title)
      .then((r) => {
        if (!cancelled) setLyrics(r)
      })
      .catch(() => {
        if (!cancelled) setLyrics({ status: 'empty' })
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, current, lyrics])

  // Switching track invalidates the lyrics we fetched for the last one.
  useEffect(() => {
    setLyrics(null)
    setTab('artwork')
  }, [current?.id])

  async function toggleLike() {
    if (!user || !current) return
    const nextLiked = !liked
    setLiked(nextLiked)
    try {
      await setSongLike(user.id, current.id, nextLiked)
    } catch (err) {
      console.error('[beatboxed] song like failed:', err)
      setLiked(!nextLiked)
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-16 text-center">
        <Disc3 className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="text-card-title">Nothing playing</p>
        <p className="max-w-sm text-body text-muted-foreground">
          Press play on a song and it'll show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 pt-2">
      <div
        className="no-scrollbar flex gap-2 overflow-x-auto"
        role="group"
        aria-label="View"
      >
        <Chip active={tab === 'artwork'} onClick={() => setTab('artwork')}>
          Artwork
        </Chip>
        <Chip active={tab === 'lyrics'} onClick={() => setTab('lyrics')}>
          Lyrics
        </Chip>
      </div>

      {tab === 'artwork' ? (
        <div className="aspect-square w-full overflow-hidden rounded-card shadow-card">
          {current.coverUrl ? (
            <img
              src={current.coverUrl}
              alt={current.title}
              className="size-full object-cover"
            />
          ) : (
            <div className="grid size-full place-items-center bg-surface-2">
              <Disc3 className="size-16 text-white/40" strokeWidth={1.25} />
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-64 rounded-card bg-surface p-5 shadow-card">
          {lyricsLoading ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              Looking up lyrics…
            </div>
          ) : lyrics?.status === 'found' ? (
            <div className="flex flex-col gap-1.5">
              {/* No line highlighting: a 30-second preview is an unknown
                  slice of the track, so timings wouldn't line up. */}
              {lyrics.lines.map((line, i) => (
                <p key={i} dir="auto" className="text-body">
                  {line}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <MicVocal className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-card-title">Lyrics not found</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 dir="auto" className="truncate text-page-title">
              {current.title}
            </h1>
            {/* No artist page yet, same as the Song page. */}
            <p dir="auto" className="truncate text-body text-accent">
              {current.artistName}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? 'Remove from liked songs' : 'Add to liked songs'}
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
          >
            <Heart
              className={cn('size-5', liked && 'fill-primary text-primary')}
              strokeWidth={1.75}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-muted-foreground">
            Preview
          </span>
          {unavailable && (
            <span className="text-meta text-danger">Preview unavailable</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={duration || 30}
          step={0.1}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={unavailable || duration === 0}
          aria-label="Seek"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-primary disabled:opacity-40"
        />
        <div className="flex justify-between text-meta text-muted-foreground">
          <span>{clock(position)}</span>
          <span>{clock(duration || 30)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={previous}
          aria-label="Previous"
          className="grid size-12 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <SkipBack className="size-6 fill-current" strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={() => toggle()}
          disabled={loading || unavailable}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="grid size-16 place-items-center rounded-full bg-primary text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95 disabled:opacity-40 disabled:hover:bg-primary"
        >
          {loading ? (
            <Loader2 className="size-7 animate-spin" strokeWidth={2.5} aria-hidden />
          ) : isPlaying ? (
            <Pause className="size-7 fill-current" strokeWidth={2} />
          ) : (
            <Play className="size-7 translate-x-0.5 fill-current" strokeWidth={2} />
          )}
        </button>

        <button
          type="button"
          onClick={next}
          aria-label="Next"
          className="grid size-12 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <SkipForward className="size-6 fill-current" strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/song/${current.id}`}
          className="flex items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:text-foreground active:scale-[0.98]"
        >
          Song details
        </Link>

        {current.spotifyId && (
          <a
            href={`https://open.spotify.com/track/${current.spotifyId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:text-foreground active:scale-[0.98]"
          >
            <ExternalLink className="size-4" strokeWidth={1.75} />
            Open in Spotify
          </a>
        )}

        {/* Beatie opens from here later; the slot is reserved, not wired. */}
        <button
          type="button"
          disabled
          title="Beatie is coming soon"
          className="flex items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2.5 text-button text-muted-foreground opacity-50"
        >
          <Sparkles className="size-4" strokeWidth={1.75} />
          Ask Beatie
        </button>
      </div>
    </div>
  )
}
