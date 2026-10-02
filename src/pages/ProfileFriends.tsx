import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PersonCard } from '@/components/people/PersonCard'
import { ListPageShell, FilterBox } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import {
  getFriendStates,
  getFriendsListVisible,
  getFriendsPublic,
  getProfileDetail,
} from '@/lib/catalog'
import type { FriendState, PersonCardModel } from '@/lib/types'

const PAGE = 30

export default function ProfileFriends() {
  const { userId } = useParams()
  const { user } = useAuth()
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [name, setName] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const [friends, setFriends] = useState<PersonCardModel[]>([])
  const [states, setStates] = useState<Map<string, FriendState>>(new Map())
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
      getFriendsListVisible(targetId),
      getFriendsPublic(targetId, { limit: PAGE }),
    ])
      .then(async ([profile, isVisible, page]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setVisible(isVisible)
        setFriends(page)
        setExhausted(page.length < PAGE)
        if (user && page.length) {
          setStates(await getFriendStates(user.id, page.map((p) => p.id)))
        }
      })
      .catch((err) => console.error('[beatboxed] friends list failed:', err))
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
      const next = await getFriendsPublic(targetId, {
        limit: PAGE,
        offset: friends.length,
      })
      setFriends((prev) => [...prev, ...next])
      setExhausted(next.length < PAGE)
      if (user && next.length) {
        const more = await getFriendStates(user.id, next.map((p) => p.id))
        setStates((prev) => new Map([...prev, ...more]))
      }
    } catch (err) {
      console.error('[beatboxed] load more friends failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(
      (p) =>
        (p.displayName ?? '').toLowerCase().includes(q) ||
        (p.username ?? '').toLowerCase().includes(q)
    )
  }, [friends, filter])

  const title = isOwn ? 'Your friends' : `${name ?? 'Listener'}'s friends`

  // Hidden lists are a deliberate state, not an empty one — say so.
  if (!loading && !visible && !isOwn) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <h1 className="text-page-title">{title}</h1>
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
          <Lock className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <p className="text-card-title">
            {name ?? 'This listener'}'s friends list is private
          </p>
        </div>
      </div>
    )
  }

  return (
    <ListPageShell
      title={title}
      toolbar={
        friends.length > 0 ? (
          <FilterBox
            value={filter}
            onChange={setFilter}
            placeholder="Filter by name or username"
          />
        ) : undefined
      }
      loading={loading}
      isEmpty={shown.length === 0}
      emptyTitle={filter ? 'No matches' : 'No friends yet'}
      emptyDetail={
        filter
          ? 'Nothing here under that filter.'
          : isOwn
            ? 'Find people in Explore and send a request.'
            : `${name ?? 'This listener'} hasn't added anyone yet.`
      }
      hasMore={!exhausted && !filter}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    >
      <div className="flex flex-col gap-3">
        {shown.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            state={states.get(person.id) ?? 'none'}
            // Your own row would offer to befriend yourself.
            showAction={person.id !== user?.id}
            onStateChange={(next) =>
              setStates((prev) => new Map(prev).set(person.id, next))
            }
          />
        ))}
      </div>
    </ListPageShell>
  )
}
