import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ImagePlus,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { PlaylistCover } from '@/components/playlist/PlaylistCover'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
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

  if (loading) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <div className="flex gap-5">
          <div className="size-40 animate-pulse rounded-card bg-surface" />
          <div className="flex flex-1 flex-col gap-3 py-2">
            <div className="h-7 w-2/3 animate-pulse rounded bg-surface" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface" />
          </div>
        </div>
        <div className="h-64 animate-pulse rounded-card bg-surface" />
      </div>
    )
  }

  if (missing || !playlist) {
    return (
      <div className="rounded-card bg-surface px-6 py-16 text-center">
        <p className="text-card-title">Playlist not found</p>
        <p className="mt-2 text-body text-muted-foreground">
          It may have been deleted by its owner.
        </p>
      </div>
    )
  }

  const total = formatTotalDuration(songs)
  const covers = songs
    .map((s) => s.coverUrl)
    .filter((c): c is string => Boolean(c))
    .slice(0, 4)
  const playingThis = songs.some((s) => s.id === player.current?.id)

  return (
    <div className="flex flex-col gap-8 pt-2">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="w-40 shrink-0 self-center sm:self-auto">
          {isOwner ? (
            <>
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={uploadingCover}
                aria-label="Change playlist cover"
                className="group relative block w-full rounded-[10px] transition-transform duration-200 ease-soft active:scale-[0.98]"
              >
                <PlaylistCover
                  covers={covers}
                  seed={playlist.id}
                  customUrl={playlist.coverUrl}
                />
                <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-black/50 opacity-0 transition-opacity duration-200 ease-soft group-hover:opacity-100 group-focus-visible:opacity-100">
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
              <h1 dir="auto" className="text-page-title">
                {playlist.title}
              </h1>
              {playlist.description && (
                <p dir="auto" className="text-body text-muted-foreground">
                  {playlist.description}
                </p>
              )}
              <p className="text-secondary text-muted-foreground">
                <Link
                  to={`/profile/${playlist.ownerId}`}
                  className="text-accent transition-colors duration-200 ease-soft hover:text-foreground"
                >
                  {playlist.ownerName}
                </Link>
                {' · '}
                {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                {total && ` · ${total}`}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={songs.length === 0}
                  onClick={() =>
                    playingThis && player.isPlaying
                      ? player.toggle()
                      : player.playQueue(songs, 0)
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

                {isOwner && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="flex items-center gap-1.5 rounded-button border border-white/10 bg-surface-2 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                    >
                      <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
                      Edit
                    </button>

                    {/* Two-step inline confirm, the same shape as unfriend
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
                          className="flex items-center gap-1.5 rounded-button bg-danger/15 px-3 py-1.5 text-button text-danger transition-colors duration-200 ease-soft hover:bg-danger/25 disabled:opacity-60"
                        >
                          {deleting && (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          )}
                          Delete playlist
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(false)}
                          className="rounded-button px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        aria-label="Delete playlist"
                        className="flex items-center gap-1.5 rounded-button border border-white/10 bg-surface-2 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger"
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {songs.length === 0 ? (
        <div className="rounded-card bg-surface px-6 py-12 text-center">
          <p className="text-card-title">Nothing here yet</p>
          <p className="mt-2 text-body text-muted-foreground">
            {isOwner
              ? 'Add songs from any song page.'
              : "This playlist doesn't have any songs."}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
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
                  'group flex items-center gap-3 rounded-card px-2 py-2 transition-colors duration-200 ease-soft hover:bg-surface',
                  isCurrent && 'bg-surface'
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

                <span className="w-5 shrink-0 text-end text-meta text-muted-foreground">
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

                <span className="shrink-0 text-meta text-muted-foreground">
                  {formatDuration(song.durationMs)}
                </span>

                {isOwner && (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move ${song.title} up`}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, i + 1)}
                      disabled={i === songs.length - 1}
                      aria-label={`Move ${song.title} down`}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(song)}
                      aria-label={`Remove ${song.title}`}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-danger"
                    >
                      <X className="size-4" strokeWidth={2} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
