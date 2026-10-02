import { useCallback, useEffect, useState } from 'react'
import { Check, ListPlus, Loader2, Plus } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { PlaylistForm } from './PlaylistForm'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import {
  addSongToPlaylist,
  createPlaylist,
  getPlaylistsContaining,
  getUserPlaylists,
  removeSongFromPlaylist,
  type PlaylistSummary,
} from '@/lib/playlists'

/**
 * "Add to playlist" for a single song, on the Song page and Now Playing.
 *
 * The picker lists the user's playlists with a tick on the ones that already
 * hold this song, so it doubles as a remove. Adding reports back with an
 * Undo, because the playlist it landed in may be off screen.
 */
export function AddToPlaylistButton({
  songId,
  variant = 'default',
}: {
  songId: string
  /** 'subtle' matches the icon-only controls on Now Playing. */
  variant?: 'default' | 'subtle'
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null)
  const [containing, setContaining] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const [lists, has] = await Promise.all([
      getUserPlaylists(user.id),
      getPlaylistsContaining(user.id, songId),
    ])
    setPlaylists(lists)
    setContaining(has)
  }, [user, songId])

  useEffect(() => {
    if (!open) return
    setPlaylists(null)
    load().catch((err) => {
      console.error('[beatboxed] could not load playlists:', err)
      setPlaylists([])
    })
  }, [open, load])

  async function toggle(playlist: PlaylistSummary) {
    if (busyId) return
    setBusyId(playlist.id)
    const alreadyIn = containing.has(playlist.id)
    try {
      if (alreadyIn) {
        await removeSongFromPlaylist(playlist.id, songId)
        setContaining((prev) => {
          const next = new Set(prev)
          next.delete(playlist.id)
          return next
        })
        toast.show({
          message: `Removed from ${playlist.title}`,
          actionLabel: 'Undo',
          onAction: () => {
            void addSongToPlaylist(playlist.id, songId).then(() =>
              setContaining((prev) => new Set(prev).add(playlist.id))
            )
          },
        })
      } else {
        await addSongToPlaylist(playlist.id, songId)
        setContaining((prev) => new Set(prev).add(playlist.id))
        toast.show({
          message: `Added to ${playlist.title}`,
          actionLabel: 'Undo',
          onAction: () => {
            void removeSongFromPlaylist(playlist.id, songId).then(() =>
              setContaining((prev) => {
                const next = new Set(prev)
                next.delete(playlist.id)
                return next
              })
            )
          },
        })
      }
      setOpen(false)
    } catch (err) {
      console.error('[beatboxed] playlist update failed:', err)
      toast.show({ message: "That didn't save. Try again." })
    } finally {
      setBusyId(null)
    }
  }

  if (!user) return null

  const trigger =
    variant === 'subtle'
      ? 'grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95'
      : 'flex shrink-0 items-center gap-1.5 rounded-button border border-white/10 bg-surface-2 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground'

  return (
    // relative so the desktop popover anchors to this button.
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setCreating(false)
          setOpen((o) => !o)
        }}
        aria-label="Add to playlist"
        aria-expanded={open}
        className={trigger}
      >
        <ListPlus className="size-4" strokeWidth={2} aria-hidden />
        {variant === 'default' && 'Add to playlist'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add to playlist">
        {creating ? (
          <div className="p-1">
            <PlaylistForm
              showCover={false}
              submitLabel="Create and add"
              onCancel={() => setCreating(false)}
              onSubmit={async ({ title, description }) => {
                if (!user) return
                const made = await createPlaylist(user.id, title, description)
                await addSongToPlaylist(made.id, songId)
                setCreating(false)
                setOpen(false)
                toast.show({ message: `Added to ${made.title}` })
              }}
            />
          </div>
        ) : (
          <>
            {playlists === null ? (
              <p className="flex items-center gap-2 px-3 py-4 text-body text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading your playlists…
              </p>
            ) : playlists.length === 0 ? (
              <p className="px-3 py-3 text-body text-muted-foreground">
                No playlists yet. Make your first one below.
              </p>
            ) : (
              <ul className="flex flex-col">
                {playlists.map((p) => {
                  const inList = containing.has(p.id)
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => void toggle(p)}
                        aria-pressed={inList}
                        className="flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-start transition-colors duration-200 ease-soft hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span dir="auto" className="block truncate text-body">
                            {p.title}
                          </span>
                          <span className="block text-meta text-muted-foreground">
                            {p.songCount} {p.songCount === 1 ? 'song' : 'songs'}
                          </span>
                        </span>
                        {busyId === p.id ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                        ) : inList ? (
                          <Check className="size-4 shrink-0 text-primary" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-button px-3 py-2.5 text-start text-button text-accent transition-colors duration-200 ease-soft hover:bg-surface-2"
            >
              <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              New playlist
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}
