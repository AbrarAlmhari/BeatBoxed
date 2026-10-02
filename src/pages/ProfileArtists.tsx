import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FollowedArtistsGrid } from '@/components/profile/FollowedArtistsGrid'
import { ListPageShell, FilterBox } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import {
  getFollowedArtistIds,
  getFollowedArtistsPage,
  getProfileDetail,
} from '@/lib/catalog'
import type { ArtistCardModel } from '@/lib/types'

const PAGE = 30

export default function ProfileArtists() {
  const { userId } = useParams()
  const { user } = useAuth()
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [name, setName] = useState<string | null>(null)
  const [artists, setArtists] = useState<ArtistCardModel[]>([])
  const [myFollows, setMyFollows] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)

    Promise.all([
      getProfileDetail(targetId),
      getFollowedArtistsPage(targetId, { limit: PAGE }),
      // Follow buttons show *your* state, even on someone else's list.
      user ? getFollowedArtistIds(user.id) : Promise.resolve(new Set<string>()),
    ])
      .then(([profile, page, mine]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setArtists(page)
        setExhausted(page.length < PAGE)
        setMyFollows(mine)
      })
      .catch((err) => console.error('[beatboxed] artists list failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetId, user])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await getFollowedArtistsPage(targetId, {
        limit: PAGE,
        offset: artists.length,
      })
      setArtists((prev) => [...prev, ...next])
      setExhausted(next.length < PAGE)
    } catch (err) {
      console.error('[beatboxed] load more artists failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return artists
    return artists.filter((a) => a.name.toLowerCase().includes(q))
  }, [artists, filter])

  return (
    <ListPageShell
      title={isOwn ? 'Artists you follow' : `${name ?? 'Listener'}'s artists`}
      toolbar={
        artists.length > 0 ? (
          <FilterBox value={filter} onChange={setFilter} placeholder="Filter by name" />
        ) : undefined
      }
      loading={loading}
      isEmpty={shown.length === 0}
      emptyTitle={filter ? 'No matches' : 'No artists followed'}
      emptyDetail={
        filter
          ? 'Nothing here under that filter.'
          : isOwn
            ? 'Follow an artist from a song page or from search.'
            : `${name ?? 'This listener'} isn't following anyone yet.`
      }
      hasMore={!exhausted && !filter}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    >
      <FollowedArtistsGrid
        artists={shown}
        showUnfollow={isOwn}
        onUnfollowed={(artistId) =>
          setArtists((prev) => prev.filter((a) => a.id !== artistId))
        }
        followedByViewer={myFollows}
      />
    </ListPageShell>
  )
}
