import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Heart,
  ImagePlus,
  Loader2,
  Lock,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import { PersonAvatar } from '@/components/conversations/PersonAvatar'
import { PlaylistCover } from '@/components/playlist/PlaylistCover'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { Skeleton } from '@/components/ui/Skeleton'
import { COVER_FALLBACK, useCoverColors } from '@/lib/coverColors'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  addSongToPlaylist,
  deletePlaylist,
  formatDuration,
  formatTotalDuration,
  getPlaylist,
  getPlaylistSocial,
  markSavedPlaylistOpened,
  setPlaylistLike,
  setPlaylistPrivate,
  setPlaylistSave,
  type PlaylistSocial,
  removeSongFromPlaylist,
  setPlaylistOrder,
  updatePlaylist,
  uploadPlaylistCover,
  removePlaylistCover,
  type PlaylistDetail,
  type PlaylistTrack,
} from '@/lib/playlists'
import { checkCoverFile, COVER_TYPES } from '@/lib/image'

export default function Playlist() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const player = usePlayer()
  const toast = useToast()

  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** Index being dragged on desktop; null when nothing is in flight. */
  const dragFrom = useRef<number | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [social, setSocial] = useState<PlaylistSocial | null>(null)

  const load = useCallback(async () => {
    const detail = await getPlaylist(id)
    if (!detail) {
      setMissing(true)
      return
    }
    setPlaylist(detail)
  }, [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMissing(false)
    getPlaylist(id)
      .then((detail) => {
        if (cancelled) return
        if (!detail) setMissing(true)
        else setPlaylist(detail)
      })
      .catch((err) => {
        console.error('[beatboxed] playlist failed to load:', err)
        if (!cancelled) setMissing(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const isOwner = Boolean(user && playlist && user.id === playlist.ownerId)
  const songs = playlist?.songs ?? []

  // Likes and saves, in one request. Opening a playlist you saved clears
  // its "N new songs" in the Library.
  const playlistId = playlist?.id
  useEffect(() => {
    if (!playlistId) return
    let live = true
    getPlaylistSocial(playlistId)
      .then((next) => {
        if (!live) return
        setSocial(next)
        if (next.savedByMe) void markSavedPlaylistOpened(playlistId).catch(() => {})
      })
      .catch((err) => console.warn('[beatboxed] playlist likes failed:', err))
    return () => {
      live = false
    }
  }, [playlistId])

  async function toggleLike() {
    if (!user || !playlist || !social) return
    const next = !social.likedByMe
    const apply = (liked: boolean) =>
      setSocial((s) => s && { ...s, likedByMe: liked, likeCount: s.likeCount + (liked ? 1 : -1) })
    apply(next)
    try {
      await setPlaylistLike(playlist.id, user.id, next)
    } catch (err) {
      console.error('[beatboxed] playlist like failed:', err)
      apply(!next)
      toast.show({ message: "Couldn't save that like. Try again." })
    }
  }

  async function toggleSave() {
    if (!user || !playlist || !social) return
    const next = !social.savedByMe
    const apply = (saved: boolean) =>
      setSocial((s) => s && { ...s, savedByMe: saved, saveCount: s.saveCount + (saved ? 1 : -1) })
    apply(next)
    try {
      await setPlaylistSave(playlist.id, user.id, next)
      if (next) {
        toast.show({
          icon: <Bookmark className="size-5 fill-current" strokeWidth={1.75} aria-hidden />,
          message: 'Saved to your Library',
          actionLabel: 'View',
          onAction: () => navigate('/library?tab=saved'),
        })
      } else {
        toast.show({ message: 'Removed from your Library' })
      }
    } catch (err) {
      console.error('[beatboxed] playlist save failed:', err)
      apply(!next)
      toast.show({ message: "Couldn't save that. Try again." })
    }
  }

  async function togglePrivate() {
    if (!user || !playlist) return
    const next = !playlist.isPrivate
    setPlaylist({ ...playlist, isPrivate: next })
    try {
      await setPlaylistPrivate(playlist.id, user.id, next)
      toast.show({
        message: next ? 'Only you can see this playlist now.' : 'This playlist is visible on your profile again.',
      })
    } catch (err) {
      console.error('[beatboxed] playlist privacy failed:', err)
      setPlaylist({ ...playlist, isPrivate: !next })
      toast.show({ message: "Couldn't change that. Try again." })
    }
  }

  /**
   * Writes a new order optimistically. The list is the user's own and the
   * write is a single upsert, so showing the moved row immediately and
   * reloading on failure beats a spinner on every nudge.
   */
  const commitOrder = useCallback(
    async (next: PlaylistTrack[]) => {
      if (!playlist) return
      const previous = playlist.songs
      setPlaylist({ ...playlist, songs: next.map((s, i) => ({ ...s, position: i })) })
      try {
        await setPlaylistOrder(playlist.id, next.map((s) => s.id))
      } catch (err) {
        console.error('[beatboxed] reorder failed:', err)
        setPlaylist({ ...playlist, songs: previous })
        toast.show({ message: "Couldn't save the new order." })
      }
    },
    [playlist, toast]
  )

  /** Tapping the cover on the page uploads straight away, no form. */
  async function pickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !playlist || !user) return

    const check = checkCoverFile(file)
    if (!check.ok) {
      toast.show({ message: check.message })
      return
    }

    setUploadingCover(true)
    try {
      const url = await uploadPlaylistCover(user.id, playlist.id, file)
      setPlaylist((p) => (p ? { ...p, coverUrl: url } : p))
      toast.show({ message: 'Cover updated' })
    } catch (err) {
      console.error('[beatboxed] cover upload failed:', err)
      toast.show({ message: "Couldn't upload that image." })
    } finally {
      setUploadingCover(false)
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= songs.length || from === to) return
    const next = [...songs]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    void commitOrder(next)
  }

  async function remove(track: PlaylistTrack) {
    if (!playlist) return
    const previous = playlist.songs
    setPlaylist({
      ...playlist,
      songs: previous.filter((s) => s.id !== track.id),
    })
    try {
      await removeSongFromPlaylist(playlist.id, track.id)
      toast.show({
        message: `Removed ${track.title}`,
        actionLabel: 'Undo',
        onAction: () => {
          void addSongToPlaylist(playlist.id, track.id)
            // Re-reading keeps position truthful: the song goes back on the
            // end, not necessarily where it was.
            .then(() => load())
            .catch((err) => console.error('[beatboxed] undo failed:', err))
        },
      })
    } catch (err) {
      console.error('[beatboxed] remove failed:', err)
      setPlaylist({ ...playlist, songs: previous })
      toast.show({ message: "Couldn't remove that song." })
    }
  }

  // Hooks before the early returns. The glow follows the playlist's own
  // cover, or the first song's when it has none (the grid's first tile).
  // A custom cover glows on its own; the mosaic glows from its first two
  // tiles, one colour each.
  const tileCovers = (playlist?.songs ?? []).map((s) => s.coverUrl).filter((c): c is string => Boolean(c))
  const glowSource = playlist?.coverUrl ?? tileCovers[0]
  const firstColors = useCoverColors(glowSource)
  const secondColors = useCoverColors(playlist?.coverUrl ? null : tileCovers[1])
  const coverColors: [string, string] | null =
    firstColors && secondColors ? [firstColors[0], secondColors[0]] : firstColors

  if (loading) {
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

  if (missing || !playlist) {
    return (
      <EmptyState face="sleepy-sticker" title="Playlist not found" detail="It may have been deleted by its owner." />
    )
  }

  const total = formatTotalDuration(songs)
  const covers = songs
    .map((s) => s.coverUrl)
    .filter((c): c is string => Boolean(c))
    .slice(0, 4)
  const playingThis = songs.some((s) => s.id === player.current?.id)

  function shuffle() {
    const order = [...songs]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    player.playQueue(order, 0)
  }

  return (
    <div className="relative isolate flex flex-col gap-8 pt-2">
      <header className="relative flex flex-col gap-5 pb-2 sm:flex-row sm:items-end">
        <PageGlow strength="hero" colors={coverColors ?? COVER_FALLBACK} />
        <div className="w-48 shrink-0 self-center sm:w-52 sm:self-auto">
          {isOwner ? (
            <>
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={uploadingCover}
                aria-label="Change playlist cover"
                className="group relative block w-full rounded-cover transition-transform duration-200 ease-soft active:scale-[0.98]"
              >
                <PlaylistCover
                  covers={covers}
                  seed={playlist.id}
                  customUrl={playlist.coverUrl}
                />
                <span className="absolute inset-0 grid place-items-center rounded-cover bg-black/50 opacity-0 transition-opacity duration-200 ease-soft group-hover:opacity-100 group-focus-visible:opacity-100">
                  {uploadingCover ? (
                    <Loader2 className="size-6 animate-spin text-white" aria-hidden />
                  ) : (
                    <ImagePlus className="size-6 text-white" strokeWidth={1.75} aria-hidden />
                  )}
                </span>
              </button>
              <input
                ref={coverInput}
                type="file"
                accept={COVER_TYPES.join(',')}
                onChange={pickCover}
                aria-label="Playlist cover image"
                className="sr-only"
              />
            </>
          ) : (
            <PlaylistCover
              covers={covers}
              seed={playlist.id}
              customUrl={playlist.coverUrl}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {editing ? (
            <PlaylistForm
              initialTitle={playlist.title}
              initialDescription={playlist.description ?? ''}
              initialCoverUrl={playlist.coverUrl}
              derivedCovers={covers}
              coverSeed={playlist.id}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              onSubmit={async ({ title, description, coverFile, removeCover }) => {
                await updatePlaylist(playlist.id, { title, description })

                let coverUrl = playlist.coverUrl
                if (user && removeCover && !coverFile) {
                  await removePlaylistCover(user.id, playlist.id)
                  coverUrl = null
                } else if (user && coverFile) {
                  coverUrl = await uploadPlaylistCover(
                    user.id,
                    playlist.id,
                    coverFile
                  )
                }

                setPlaylist({
                  ...playlist,
                  title: title.trim(),
                  description: description.trim() || null,
                  coverUrl,
                })
                setEditing(false)
              }}
            />
          ) : (
            <>
              <h1 dir="auto" className="text-center text-page-title sm:text-left">
                {playlist.title}
              </h1>
              {playlist.description && (
                <p dir="auto" className="text-center text-body text-muted-foreground sm:text-left">
                  {playlist.description}
                </p>
              )}
              <div className="flex flex-col items-center gap-1 sm:items-start">
                <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-body text-muted-foreground">
                  <Link
                    to={`/profile/${playlist.ownerId}`}
                    className="flex items-center gap-2 font-semibold text-foreground transition-colors duration-200 ease-soft hover:text-accent"
                  >
                    <PersonAvatar name={playlist.ownerName} url={playlist.ownerAvatarUrl} className="size-7 text-meta" />
                    {playlist.ownerName}
                  </Link>
                  <span>
                    · {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                    {total && ` · ${total}`}
                  </span>
                  {isOwner && playlist.isPrivate && (
                    <span className="flex items-center gap-1 rounded-chip bg-surface-2 px-2.5 py-0.5 text-meta text-muted-foreground">
                      <Lock className="size-3" strokeWidth={2} aria-hidden />
                      Private
                    </span>
                  )}
                </p>
                {social && (
                  <p className="text-secondary text-muted-foreground">
                    Liked by {social.likeCount} · Saved by {social.saveCount}
                  </p>
                )}
              </div>

              {!isOwner && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleLike()}
                    disabled={!social}
                    aria-pressed={social?.likedByMe ?? false}
                    aria-label={social?.likedByMe ? 'Unlike this playlist' : 'Like this playlist'}
                    className={cn(
                      'flex min-h-12 items-center gap-2 rounded-chip px-5 text-button transition-colors duration-200 ease-soft disabled:opacity-60',
                      social?.likedByMe ? 'bg-like/15 text-like' : 'bg-surface-2 text-foreground hover:bg-white/10'
                    )}
                  >
                    <Heart className={cn('size-5', social?.likedByMe && 'fill-like')} strokeWidth={1.75} aria-hidden />
                    {social?.likeCount ?? 0}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleSave()}
                    disabled={!social}
                    aria-pressed={social?.savedByMe ?? false}
                    className={cn(
                      'flex min-h-12 items-center gap-2 rounded-chip border-2 px-5 text-button transition-colors duration-200 ease-soft disabled:opacity-60',
                      social?.savedByMe
                        ? 'border-primary/80 bg-primary/20 text-foreground'
                        : 'border-transparent bg-surface-2 text-foreground hover:bg-white/10'
                    )}
                  >
                    <Bookmark
                      className={cn('size-5', social?.savedByMe && 'fill-accent text-accent')}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {social?.savedByMe ? 'Saved' : 'Save'}
                  </button>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={shuffle}
                    disabled={songs.length === 0}
                    aria-label="Shuffle"
                    className="grid size-12 place-items-center rounded-full bg-surface-2 text-foreground transition-colors duration-200 ease-soft hover:bg-white/10 disabled:opacity-50"
                  >
                    <Shuffle className="size-5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    disabled={songs.length === 0}
                    onClick={() => (playingThis && player.isPlaying ? player.toggle() : player.playQueue(songs, 0))}
                    aria-label={playingThis && player.isPlaying ? 'Pause' : 'Play'}
                    className="grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_8px_28px_rgb(139_92_246/0.45)] transition-all duration-200 ease-soft hover:bg-accent active:scale-95 disabled:opacity-50"
                  >
                    {playingThis && player.isPlaying ? (
                      <Pause className="size-6 fill-current" strokeWidth={0} />
                    ) : (
                      <Play className="ml-0.5 size-6 fill-current" strokeWidth={0} />
                    )}
                  </button>
                </div>
              )}

              {isOwner && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={songs.length === 0}
                  onClick={() =>
                    playingThis && player.isPlaying
                      ? player.toggle()
                      : player.playQueue(songs, 0)
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

                {isOwner && (
                  <>
                    <button
                      type="button"
                      onClick={() => void togglePrivate()}
                      aria-pressed={playlist.isPrivate}
                      className="flex min-h-11 items-center gap-1.5 rounded-button border border-line-strong bg-surface-2 px-3.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                    >
                      {playlist.isPrivate ? (
                        <Unlock className="size-4" strokeWidth={1.75} aria-hidden />
                      ) : (
                        <Lock className="size-4" strokeWidth={1.75} aria-hidden />
                      )}
                      {playlist.isPrivate ? 'Make public' : 'Make private'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="flex min-h-11 items-center gap-1.5 rounded-button border border-line-strong bg-surface-2 px-3.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                    >
                      <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
                      Edit
                    </button>

                    {/* Two-step inline confirm, the same shape as unfollow
                        and delete-comment elsewhere in the app. */}
                    {confirmingDelete ? (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={async () => {
                            setDeleting(true)
                            try {
                              await deletePlaylist(playlist.id, playlist.ownerId)
                              toast.show({ message: `Deleted ${playlist.title}` })
                              navigate('/library', { replace: true })
                            } catch (err) {
                              console.error('[beatboxed] delete failed:', err)
                              toast.show({ message: "Couldn't delete that." })
                              setDeleting(false)
                              setConfirmingDelete(false)
                            }
                          }}
                          className="flex min-h-11 items-center gap-1.5 rounded-button bg-danger/15 px-3.5 text-button text-danger transition-colors duration-200 ease-soft hover:bg-danger/25 disabled:opacity-60"
                        >
                          {deleting && (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          )}
                          Delete playlist
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(false)}
                          className="min-h-11 rounded-button px-3.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        aria-label="Delete playlist"
                        className="flex min-h-11 items-center gap-1.5 rounded-button border border-line-strong bg-surface-2 px-3.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger"
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
              )}
            </>
          )}
        </div>
      </header>

      {songs.length === 0 ? (
        <EmptyState
          face="happy-sticker"
          title="Nothing here yet"
          detail={isOwner ? 'Add songs from any song page.' : "This playlist doesn't have any songs."}
        />
      ) : (
        <Card as="ol" padding="sm" className="flex flex-col gap-0.5">
          {songs.map((song, i) => {
            const isCurrent = player.current?.id === song.id
            return (
              <li
                key={song.id}
                draggable={isOwner}
                onDragStart={() => {
                  dragFrom.current = i
                }}
                onDragOver={(e) => {
                  if (isOwner && dragFrom.current !== null) e.preventDefault()
                }}
                onDrop={() => {
                  if (dragFrom.current === null) return
                  move(dragFrom.current, i)
                  dragFrom.current = null
                }}
                className={cn(
                  'group flex items-center gap-3 rounded-inset px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface-2',
                  isCurrent && 'bg-surface-2'
                )}
              >
                {isOwner && (
                  // Pointer-only: touch devices get the move buttons instead,
                  // where a drag would fight the page scroll.
                  <span
                    aria-hidden
                    className="hidden cursor-grab text-muted-foreground active:cursor-grabbing sm:block"
                  >
                    <GripVertical className="size-4" strokeWidth={1.75} />
                  </span>
                )}

                {/* Owners' rows carry three controls; the number steps aside on
                    phones so the title keeps its room. */}
                <span className={cn('w-5 shrink-0 text-end text-meta text-muted-foreground', isOwner && 'hidden sm:inline')}>
                  {i + 1}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    isCurrent ? player.toggle() : player.playQueue(songs, i)
                  }
                  aria-label={
                    isCurrent && player.isPlaying
                      ? `Pause ${song.title}`
                      : `Play ${song.title}`
                  }
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
                  <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-200 ease-soft group-hover:opacity-100 focus-visible:opacity-100">
                    {isCurrent && player.isPlaying ? (
                      <Pause className="size-4 text-white" strokeWidth={2} />
                    ) : (
                      <Play className="size-4 fill-white text-white" strokeWidth={2} />
                    )}
                  </span>
                </button>

                <Link
                  to={`/song/${song.id}`}
                  className="min-w-0 flex-1 transition-colors duration-200 ease-soft hover:text-accent"
                >
                  <span
                    dir="auto"
                    className={cn(
                      'block truncate text-card-title',
                      isCurrent && 'text-primary'
                    )}
                  >
                    {song.title}
                  </span>
                  <span dir="auto" className="block truncate text-secondary text-muted-foreground">
                    {song.artistName}
                  </span>
                </Link>

                <span className={cn('shrink-0 text-meta text-muted-foreground', isOwner && 'hidden sm:inline')}>
                  {formatDuration(song.durationMs)}
                </span>

                {isOwner && (
                  <span className="-me-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move ${song.title} up`}
                      className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, i + 1)}
                      disabled={i === songs.length - 1}
                      aria-label={`Move ${song.title} down`}
                      className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(song)}
                      aria-label={`Remove ${song.title}`}
                      className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-danger"
                    >
                      <X className="size-4" strokeWidth={2} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </Card>
      )}
    </div>
  )
}
