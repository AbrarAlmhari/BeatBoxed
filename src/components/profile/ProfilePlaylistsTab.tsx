import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { PlaylistCover } from '@/components/playlist/PlaylistCover'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
import { Modal } from '@/components/ui/Modal'
import { SkeletonTile } from '@/components/ui/Skeleton'
import { EmptyState, emptyActionClass, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { useAuth } from '@/lib/auth'
import {
  createPlaylist,
  getUserPlaylists,
  uploadPlaylistCover,
  type PlaylistSummary,
} from '@/lib/playlists'

const GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4'

/**
 * Someone's playlists as square tiles. Privacy is unchanged: playlists are
 * visible exactly when the rest of the profile is (RLS through
 * can_view_profile). There's no per-playlist privacy, so no lock icon.
 *
 * On your own profile the first tile makes a new playlist, with the same
 * form as before.
 */
export function ProfilePlaylistsTab({
  userId,
  isOwn,
  handle,
}: {
  userId: string
  isOwn: boolean
  handle: string
}) {
  const { user } = useAuth()
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    setPlaylists(null)
    try {
      setPlaylists(await getUserPlaylists(userId))
    } catch (err) {
      console.error('[beatboxed] profile playlists failed:', err)
      setError(true)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const createTile = isOwn && (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className="flex aspect-square min-h-11 w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-primary/50 bg-primary/10 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-primary/20"
    >
      <Plus className="size-6 text-accent" strokeWidth={2} aria-hidden />
      New playlist
    </button>
  )

  return (
    <>
      {error ? (
        <EmptyState
          face="sad"
          tone="error"
          title="Couldn't load playlists."
          action={
            <button type="button" onClick={() => void load()} className={emptySecondaryActionClass}>
              Retry
            </button>
          }
        />
      ) : playlists === null ? (
        <div className={GRID} aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonTile key={i} />
          ))}
        </div>
      ) : playlists.length === 0 && !isOwn ? (
        <EmptyState face="sleepy-sticker" title={`${handle} hasn't made any playlists yet.`} />
      ) : playlists.length === 0 ? (
        <EmptyState
          face="happy-sticker"
          title="No playlists yet"
          detail="Group songs you love, for a mood, a moment or a friend."
          action={
            <button type="button" onClick={() => setCreating(true)} className={emptyActionClass}>
              <Plus className="size-4" strokeWidth={2} aria-hidden />
              Create a playlist
            </button>
          }
        />
      ) : (
        <ul className={GRID}>
          {createTile && <li>{createTile}</li>}
          {playlists.map((p) => (
            <li key={p.id}>
              <Link
                to={`/playlist/${p.id}`}
                className="group flex flex-col gap-2 rounded-card transition-transform duration-200 ease-soft active:scale-[0.98]"
              >
                <div className="overflow-hidden rounded-card shadow-card transition-transform duration-200 ease-soft group-hover:-translate-y-0.5">
                  <PlaylistCover covers={p.coverUrls} seed={p.id} customUrl={p.coverUrl} />
                </div>
                <span className="flex flex-col gap-0.5 px-0.5">
                  <span dir="auto" className="truncate text-card-title">
                    {p.title}
                  </span>
                  <span className="text-secondary text-muted-foreground">
                    {p.songCount} {p.songCount === 1 ? 'song' : 'songs'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isOwn && user && (
        <CreatePlaylistDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(made) => {
            setPlaylists((prev) => [made, ...(prev ?? [])])
            setCreating(false)
          }}
          userId={user.id}
        />
      )}
    </>
  )
}

/** The existing create form, in a sheet on phones and a dialog on desktop. */
function CreatePlaylistDialog({
  open,
  onClose,
  onCreated,
  userId,
}: {
  open: boolean
  onClose: () => void
  onCreated: (made: PlaylistSummary) => void
  userId: string
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center gap-2 px-5 pb-2 pt-3 sm:pt-5">
        <h2 id={titleId} className="flex-1 text-section-title">
          New playlist
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="overflow-y-auto px-5 pb-5">
        <PlaylistForm
          submitLabel="Create playlist"
          onCancel={onClose}
          onSubmit={async ({ title, description, coverFile }) => {
            const made = await createPlaylist(userId, title, description)
            if (coverFile) made.coverUrl = await uploadPlaylistCover(userId, made.id, coverFile)
            onCreated(made)
          }}
        />
      </div>
    </Modal>
  )
}
