import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, Loader2, Pause, Play } from 'lucide-react'
import { Artwork } from '@/components/feed/Artwork'
import { FeedCard } from '@/components/feed/FeedCard'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { useLoadMore } from './useLoadMore'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { getLikedSongs, setSongLike } from '@/lib/catalog'
import { getLikedReviews } from '@/lib/profile'
import { getLikedPlaylists, type PlaylistSummary } from '@/lib/playlists'
import { PlaylistGrid, PlaylistGridSkeleton } from '@/components/playlist/PlaylistGrid'
import type { FeedReview } from '@/lib/feed'
import type { SongCardModel } from '@/lib/types'
import { cn } from '@/lib/cn'

type Kind = 'songs' | 'reviews' | 'playlists'

/**
 * Songs, reviews and playlists this person liked. The page shows this tab only when
 * the rest of the profile is visible; the likes tables themselves are still
 * readable to anyone at the database level (TASKS.md).
 */
export function ProfileLikesTab({
  userId,
  isOwn,
  handle,
}: {
  userId: string
  isOwn: boolean
  handle: string
}) {
  const [kind, setKind] = useState<Kind>('songs')
  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Liked"
        className="flex w-full max-w-xs gap-1 self-start rounded-card border border-line-strong bg-surface p-1"
      >
        {(['songs', 'reviews', 'playlists'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'min-h-11 flex-1 rounded-button text-button transition-colors duration-200 ease-soft',
              kind === k
                ? 'border border-primary/60 bg-primary/15 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {k === 'songs' ? 'Songs' : k === 'reviews' ? 'Reviews' : 'Playlists'}
          </button>
        ))}
      </div>
      {kind === 'songs' ? (
        <LikedSongs userId={userId} isOwn={isOwn} handle={handle} />
      ) : kind === 'reviews' ? (
        <LikedReviews userId={userId} isOwn={isOwn} handle={handle} />
      ) : (
        <LikedPlaylists userId={userId} isOwn={isOwn} handle={handle} />
      )}
    </div>
  )
}

/**
 * Playlists this person liked. The database applies the privacy: only when
 * you can see their account, and only playlists you're allowed to see.
 */
function LikedPlaylists({ userId, isOwn, handle }: { userId: string; isOwn: boolean; handle: string }) {
  const [items, setItems] = useState<PlaylistSummary[] | null>(null)
  useEffect(() => {
    let live = true
    getLikedPlaylists(userId)
      .then((rows) => {
        if (!live) return
        setItems(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            description: null,
            ownerId: r.ownerId,
            sortedAt: '',
            coverUrl: r.coverUrl,
            songCount: r.songCount,
            coverUrls: r.coverUrls,
          }))
        )
      })
      .catch((err) => {
        console.error('[beatboxed] liked playlists failed:', err)
        if (live) setItems([])
      })
    return () => {
      live = false
    }
  }, [userId])

  if (items === null) return <PlaylistGridSkeleton />
  if (items.length === 0) {
    return (
      <EmptyState
        face="happy-sticker"
        title="No liked playlists yet"
        detail={isOwn ? "Tap the heart on someone's playlist to keep it here." : `${handle} hasn't liked any playlists yet.`}
      />
    )
  }
  return (
    <section aria-label="Liked playlists">
      <PlaylistGrid playlists={items} />
    </section>
  )
}

function LikedSongs({ userId, isOwn, handle }: { userId: string; isOwn: boolean; handle: string }) {
  const { user } = useAuth()
  const player = usePlayer()
  const toast = useToast()
  const [songs, setSongs] = useState<SongCardModel[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    setSongs(null)
    try {
      setSongs(await getLikedSongs(userId))
    } catch (err) {
      console.error('[beatboxed] liked songs failed:', err)
      setError(true)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  async function unlike(song: SongCardModel, index: number) {
    if (!user) return
    setSongs((prev) => (prev ?? []).filter((s) => s.id !== song.id))
    try {
      await setSongLike(user.id, song.id, false)
      toast.show({
        message: 'Removed from liked songs',
        actionLabel: 'Undo',
        onAction: () => {
          void setSongLike(user.id, song.id, true)
            .then(() =>
              setSongs((prev) => {
                const list = [...(prev ?? [])]
                list.splice(Math.min(index, list.length), 0, song)
                return list
              })
            )
            .catch((err: unknown) => console.error('[beatboxed] undo unlike failed:', err))
        },
      })
    } catch (err) {
      console.error('[beatboxed] unlike failed:', err)
      // Put it back where it was.
      setSongs((prev) => {
        const list = [...(prev ?? [])]
        list.splice(Math.min(index, list.length), 0, song)
        return list
      })
      toast.show({ message: "Couldn't remove that. Try again." })
    }
  }

  if (error) return <Retry what="liked songs" onRetry={load} />
  if (songs === null) return <RowsSkeleton />
  if (songs.length === 0) {
    return isOwn ? (
      <EmptyState
        face="happy-sticker"
        title="No liked songs yet"
        detail="Tap the heart on any song and it lands here."
        action={
          <Link to="/explore" className={emptyActionClass}>
            Find songs
          </Link>
        }
      />
    ) : (
      <EmptyState face="sleepy-sticker" title={`${handle} hasn't liked any songs yet.`} />
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {songs.map((song, i) => {
        const current = player.current?.id === song.id
        const playing = current && player.isPlaying
        return (
          <li
            key={song.id}
            className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-2.5 shadow-card"
          >
            <Link to={`/song/${song.id}`} className="shrink-0" tabIndex={-1} aria-hidden>
              <Artwork src={song.coverUrl} seed={song.id} alt={`Cover of ${song.title}`} className="size-12" />
            </Link>
            <Link to={`/song/${song.id}`} className="flex min-w-0 flex-1 flex-col">
              <span dir="auto" className="truncate text-card-title">
                {song.title}
              </span>
              <span dir="auto" className="truncate text-secondary text-muted-foreground">
                {song.artistName}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => (current ? player.toggle() : player.playQueue(songs, i))}
              aria-label={playing ? `Pause ${song.title}` : `Play ${song.title}`}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95"
            >
              {current && player.loading ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2.25} />
              ) : playing ? (
                <Pause className="size-4 fill-current" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} />
              )}
            </button>
            {isOwn ? (
              <button
                type="button"
                onClick={() => void unlike(song, i)}
                aria-label={`Unlike ${song.title}`}
                className="grid size-11 shrink-0 place-items-center rounded-full text-primary transition-colors duration-200 ease-soft hover:bg-white/5"
              >
                <Heart className="size-5 fill-primary" strokeWidth={1.75} />
              </button>
            ) : (
              <span className="grid size-11 shrink-0 place-items-center text-primary" aria-label="Liked">
                <Heart className="size-5 fill-primary" strokeWidth={1.75} aria-hidden />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function LikedReviews({ userId, isOwn, handle }: { userId: string; isOwn: boolean; handle: string }) {
  const { user } = useAuth()
  const [items, setItems] = useState<FeedReview[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  /** Likes read so far: the next page's offset (see getLikedReviews). */
  const [read, setRead] = useState(0)
  const [error, setError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setError(false)
    setItems(null)
    try {
      const page = await getLikedReviews(userId, user.id, 0)
      setItems(page.items)
      setHasMore(page.hasMore)
      setRead(page.read)
    } catch (err) {
      console.error('[beatboxed] liked reviews failed:', err)
      setError(true)
    }
  }, [user, userId])

  useEffect(() => {
    void load()
  }, [load])

  async function more() {
    if (!user || !items || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      // By likes read, not cards shown: a like on a review hidden by privacy
      // still took a slot in the page.
      const page = await getLikedReviews(userId, user.id, read)
      const seen = new Set(items.map((r) => r.id))
      setItems((prev) => [...(prev ?? []), ...page.items.filter((r) => !seen.has(r.id))])
      setHasMore(page.hasMore)
      setRead((n) => n + page.read)
    } catch (err) {
      console.error('[beatboxed] more liked reviews failed:', err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }
  const sentinel = useLoadMore(() => void more(), items !== null && hasMore)

  if (error) return <Retry what="liked reviews" onRetry={load} />
  if (items === null) return <RowsSkeleton />
  if (items.length === 0) {
    return isOwn ? (
      <EmptyState
        face="happy-sticker"
        title="No liked reviews yet"
        detail="Like a take you agree with and you'll find it here."
        action={
          <Link to="/" className={emptyActionClass}>
            Go to the feed
          </Link>
        }
      />
    ) : (
      <EmptyState face="sleepy-sticker" title={`${handle} hasn't liked any reviews yet.`} />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((r) => (
        <FeedCard
          key={r.id}
          review={r}
          onDeleted={(gone) => setItems((prev) => (prev ?? []).filter((x) => x.id !== gone.id))}
        />
      ))}
      <div ref={sentinel} aria-hidden className="h-px" />
      {loadingMore && (
        <div role="status" className="flex items-center justify-center gap-2 py-3 text-secondary text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading more…
        </div>
      )}
    </div>
  )
}

function Retry({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      face="sad"
      tone="error"
      title={`Couldn't load ${what}.`}
      action={
        <button type="button" onClick={onRetry} className={emptySecondaryActionClass}>
          Retry
        </button>
      }
    />
  )
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card bg-surface p-2.5">
          <div className="size-12 animate-pulse rounded-cover bg-surface-2" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="size-11 animate-pulse rounded-full bg-surface-2" />
        </div>
      ))}
    </div>
  )
}
