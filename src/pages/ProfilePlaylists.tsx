import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { FilterButton } from '@/components/ui/FilterButton'
import { PlaylistGrid } from '@/components/playlist/PlaylistGrid'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
import { ListPageShell, FilterBox } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import { getFollowStates, getProfileDetail } from '@/lib/catalog'
import {
  createPlaylist,
  getUserPlaylistsPage,
  uploadPlaylistCover,
  type PlaylistSort,
  type PlaylistSummary,
} from '@/lib/playlists'
import { StickyBar, STILL } from '@/components/ui/Tabs'
import { cn } from '@/lib/cn'
import { PROFILE_LIST_PAGE_SIZE as PAGE } from '@/lib/config'
import { logError } from '@/lib/log'

const SORTS: { value: PlaylistSort; label: string }[] = [
  { value: 'recent', label: 'Newest' },
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
      // Same rule as the profile page: private plus not an accepted follower
      // means the list is empty by RLS, and the page should say why.
      user && !isOwn
        ? getFollowStates(user.id, [targetId])
        : Promise.resolve(new Map<string, string>()),
    ])
      .then(([profile, page, states]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setLocked(
          Boolean(profile?.isPrivate) && !isOwn && states.get(targetId) !== 'following'
        )
        setPlaylists(page)
        setExhausted(page.length < PAGE)
      })
      .catch((err) => logError('profile', 'playlists list failed', { error: err }))
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
      logError('profile', 'load more playlists failed', { error: err })
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
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-primary/15">
            <Lock className="size-5 text-accent" strokeWidth={2} aria-hidden />
          </span>
          <p className="text-card-title">This account is private.</p>
          <p className="max-w-sm text-body text-muted-foreground">
            Follow them to request access to their reviews and playlists.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <ListPageShell
      title={title}
      toolbar={
        <>
          {isOwn &&
            (creating ? (
              <Card className="sm:max-w-md">
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
              </Card>
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

          {/* Straight in the page's column (not a wrapper) so the filter and sort
              can stay under the top bar the whole way down; the negative
              margins keep the toolbar's tighter spacing. */}
          <StickyBar className={cn('-my-2 py-2', isOwn && '-mt-5')}>
            <div className={cn(STILL, 'flex items-stretch gap-2 px-4 sm:px-6 lg:px-8')}>
              {playlists.length > 0 && (
                <div className="min-w-0 flex-1">
                  <FilterBox
                    value={filter}
                    onChange={setFilter}
                    placeholder="Filter by title"
                  />
                </div>
              )}
              <FilterButton
                title="Sort playlists"
                face="value"
                className="flex"
                buttonClassName="h-full"
                sections={[
                  {
                    title: 'Sort by',
                    options: SORTS,
                    value: sort,
                    defaultValue: 'recent',
                    onChange: (v) => setSort(v as PlaylistSort),
                  },
                ]}
              />
            </div>
          </StickyBar>
        </>
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
