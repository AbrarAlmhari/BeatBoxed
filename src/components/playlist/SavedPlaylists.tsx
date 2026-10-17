import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { PlaylistCover } from './PlaylistCover'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { getSavedPlaylists, setPlaylistSave, type SavedPlaylist } from '@/lib/playlists'

/**
 * Library → Saved: other people's playlists you saved. They're links, so
 * each shows the owner's current version, with "N new songs" when songs
 * were added since you last opened it. One you can no longer see (made
 * private, or the account went private) stays as a row you can remove; a
 * deleted one is simply gone.
 */
export function SavedPlaylists() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<SavedPlaylist[] | null>(null)

  useEffect(() => {
    getSavedPlaylists()
      .then(setRows)
      .catch((err) => {
        console.error('[beatboxed] saved playlists failed:', err)
        setRows([])
      })
  }, [])

  async function remove(id: string) {
    if (!user) return
    const previous = rows
    setRows((r) => (r ?? []).filter((x) => x.id !== id))
    try {
      await setPlaylistSave(id, user.id, false)
    } catch (err) {
      console.error('[beatboxed] remove saved playlist failed:', err)
      setRows(previous)
      toast.show({ message: "Couldn't remove that. Try again." })
    }
  }

  if (rows === null) {
    return (
      <div role="status">
        <span className="sr-only">Loading…</span>
        <SkeletonList rows={4} cover="size-16 rounded-cover" />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        face="happy-sticker"
        title="No saved playlists yet"
        detail="Open someone's playlist and tap Save to keep it here. It stays up to date with theirs."
      />
    )
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Saved playlists">
      {rows.map((p) =>
        p.available ? (
          <li key={p.id}>
            <Link
              to={`/playlist/${p.id}`}
              className="flex items-center gap-3 rounded-card p-2 transition-colors duration-200 ease-soft hover:bg-surface"
            >
              <span className="w-16 shrink-0">
                <PlaylistCover covers={p.coverUrls} seed={p.id} customUrl={p.coverUrl} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span dir="auto" className="truncate text-card-title">
                  {p.title}
                </span>
                <span className="truncate text-secondary text-muted-foreground">
                  {p.ownerName} · {p.songCount} {p.songCount === 1 ? 'song' : 'songs'}
                </span>
              </span>
              {p.newSongs > 0 && (
                <span className="shrink-0 rounded-chip bg-primary/25 px-2.5 py-1 text-meta font-semibold text-accent">
                  {p.newSongs} new {p.newSongs === 1 ? 'song' : 'songs'}
                </span>
              )}
            </Link>
          </li>
        ) : (
          <li key={p.id} data-unavailable className="flex items-center gap-3 rounded-card p-2">
            <span className="grid size-16 shrink-0 place-items-center rounded-cover bg-surface-2 text-muted-foreground">
              <Lock className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <p className="min-w-0 flex-1 text-secondary text-muted-foreground">
              No longer available. The owner made it private.
            </p>
            <button
              type="button"
              onClick={() => void remove(p.id)}
              className="min-h-11 shrink-0 rounded-chip border border-line-strong px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5"
            >
              Remove
            </button>
          </li>
        )
      )}
    </ul>
  )
}
