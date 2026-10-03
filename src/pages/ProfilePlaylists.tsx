import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { PlaylistGrid } from '@/components/playlist/PlaylistGrid'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
import { ListPageShell, FilterBox } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import { getFriendStates, getProfileDetail } from '@/lib/catalog'
import {
  createPlaylist,
  getUserPlaylistsPage,
  uploadPlaylistCover,
  type PlaylistSort,
  type PlaylistSummary,
} from '@/lib/playlists'

const PAGE = 30

const SORTS: { value: PlaylistSort; label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'az', label: 'A–Z' },
  { value: 'songs', label: 'Most songs' },
]

export default function ProfilePlaylists() {
  const { userId } = useParams()
  const { user } = useAuth()
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [name, setName] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [sort, setSort] = useState<PlaylistSort>('recent')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)

    Promise.all([
      getProfileDetail(targetId),
      getUserPlaylistsPage(targetId, { limit: PAGE, sort }),
      // Same rule as the profile page: private plus not-a-friend means the
      // list is empty by RLS, and the page should say why.
      user && !isOwn
        ? getFriendStates(user.id, [targetId])
        : Promise.resolve(new Map<string, string>()),
    ])
      .then(([profile, page, states]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setLocked(
          Boolean(profile?.isPrivate) && !isOwn && states.get(targetId) !== 'friends'
        )
        setPlaylists(page)
        setExhausted(page.length < PAGE)
      })
      .catch((err) => console.error('[beatboxed] playlists list failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // Re-reads on sort change: ordering only the loaded page would sort a
    // slice rather than the whole list.
  }, [targetId, user, isOwn, sort])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await getUserPlaylistsPage(targetId, {
        limit: PAGE,
        offset: playlists.length,
        sort,
      })
      setPlaylists((prev) => [...prev, ...next])
      setExhausted(next.length < PAGE)
    } catch (err) {
      console.error('[beatboxed] load more playlists failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return playlists
    return playlists.filter((p) => p.title.toLowerCase().includes(q))
  }, [playlists, filter])

  const title = isOwn ? 'Your playlists' : `${name ?? 'Listener'}'s playlists`

  if (!loading && locked) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <h1 dir="auto" className="text-page-title">
          {title}
        </h1>
        <div className="rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-card-title">This account is private.</p>
          <p className="mx-auto mt-2 max-w-sm text-body text-muted-foreground">
            Add them as a friend to see their reviews and playlists.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ListPageShell
      title={title}
      toolbar={
        <div className="flex flex-col gap-3">
          {isOwn &&
            (creating ? (
              <div className="rounded-card bg-surface p-4 shadow-card sm:max-w-md">
                <PlaylistForm
                  submitLabel="Create playlist"
                  onCancel={() => setCreating(false)}
                  onSubmit={async ({ title: t, description, coverFile }) => {
                    if (!user) return
                    const made = await createPlaylist(user.id, t, description)
                    if (coverFile) {
                      made.coverUrl = await uploadPlaylistCover(
                        user.id,
                        made.id,
                        coverFile
                      )
                    }
                    setPlaylists((prev) => [made, ...prev])
                    setCreating(false)
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-fit items-center gap-2 rounded-button bg-primary px-4 py-2 text-button text-white transition-all duration-200 ease-soft hover:bg-primary/90 active:scale-[0.97]"
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden />
                New playlist
              </button>
            ))}

          <div
            className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
            role="group"
            aria-label="Sort playlists"
          >
            {SORTS.map((s) => (
              <Chip
                key={s.value}
                active={sort === s.value}
                onClick={() => setSort(s.value)}
              >
                {s.label}
              </Chip>
            ))}
          </div>

          {playlists.length > 0 && (
            <FilterBox
              value={filter}
              onChange={setFilter}
              placeholder="Filter by title"
            />
          )}
        </div>
      }
      loading={loading}
      isEmpty={shown.length === 0}
      emptyTitle={filter ? 'No matches' : 'No playlists yet'}
      emptyDetail={
        filter
          ? 'Nothing here under that filter.'
          : isOwn
            ? "You haven't made any playlists yet."
            : `${name ?? 'This listener'} hasn't made any playlists yet.`
      }
      hasMore={!exhausted && !filter}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    >
      <PlaylistGrid playlists={shown} />
    </ListPageShell>
  )
}
