import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PersonCard } from '@/components/people/PersonCard'
import { RemoveFollowerButton } from '@/components/people/FollowerActions'
import { ListPageShell, FilterBox } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import {
  getFollowList,
  getFollowListsVisible,
  getFollowStates,
  getProfileDetail,
  type FollowListKind,
} from '@/lib/catalog'
import type { FollowState, PersonCardModel } from '@/lib/types'

const PAGE = 30

/** /profile/:userId/followers and /profile/:userId/following. */
export default function ProfileFollows({ kind }: { kind: FollowListKind }) {
  const { userId } = useParams()
  const { user } = useAuth()
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [name, setName] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  /** Private and the viewer isn't an accepted follower: nothing to list. */
  const [locked, setLocked] = useState(false)
  const [people, setPeople] = useState<PersonCardModel[]>([])
  const [states, setStates] = useState<Map<string, FollowState>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)
    setPeople([])
    setFilter('')

    Promise.all([
      getProfileDetail(targetId),
      getFollowListsVisible(targetId),
      getFollowList(targetId, kind, { limit: PAGE }),
      user && !isOwn ? getFollowStates(user.id, [targetId]) : Promise.resolve(null),
    ])
      .then(async ([profile, isVisible, page, mine]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setVisible(isVisible)
        setLocked(
          Boolean(profile?.isPrivate) && !isOwn && mine?.get(targetId) !== 'following'
        )
        setPeople(page)
        setExhausted(page.length < PAGE)
        if (user && page.length) {
          const s = await getFollowStates(user.id, page.map((p) => p.id))
          if (!cancelled) setStates(s)
        }
      })
      .catch((err) => console.error(`[beatboxed] ${kind} list failed:`, err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetId, kind, user, isOwn])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await getFollowList(targetId, kind, {
        limit: PAGE,
        offset: people.length,
      })
      setPeople((prev) => [...prev, ...next])
      setExhausted(next.length < PAGE)
      if (user && next.length) {
        const more = await getFollowStates(user.id, next.map((p) => p.id))
        setStates((prev) => new Map([...prev, ...more]))
      }
    } catch (err) {
      console.error(`[beatboxed] load more ${kind} failed:`, err)
    } finally {
      setLoadingMore(false)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) =>
        (p.displayName ?? '').toLowerCase().includes(q) ||
        (p.username ?? '').toLowerCase().includes(q)
    )
  }, [people, filter])

  const who = name ?? 'Listener'
  const title =
    kind === 'followers'
      ? isOwn ? 'Your followers' : `${who}'s followers`
      : isOwn ? 'People you follow' : `People ${who} follows`

  // A private account or a hidden list is a deliberate state, not an empty
  // one, so it says why rather than "nobody yet".
  if (!loading && !isOwn && (locked || !visible)) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <h1 dir="auto" className="text-page-title">
          {title}
        </h1>
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
          <Lock className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <p className="text-card-title">
            {locked
              ? 'This account is private'
              : `${name ?? 'This listener'}'s followers and following are private`}
          </p>
          {locked && (
            <p className="max-w-sm text-body text-muted-foreground">
              Follow them to request access.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <ListPageShell
      title={title}
      toolbar={
        people.length > 0 ? (
          <FilterBox
            value={filter}
            onChange={setFilter}
            placeholder="Filter by name or username"
          />
        ) : undefined
      }
      loading={loading}
      isEmpty={shown.length === 0}
      emptyTitle={
        filter ? 'No matches' : kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'
      }
      emptyDetail={
        filter
          ? 'Nothing here under that filter.'
          : isOwn
            ? kind === 'followers'
              ? 'When people follow you, they show up here.'
              : 'Find people in Explore and follow them.'
            : kind === 'followers'
              ? `Nobody follows ${name ?? 'this listener'} yet.`
              : `${name ?? 'This listener'} isn't following anyone yet.`
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
            onStateChange={(next) =>
              setStates((prev) => new Map(prev).set(person.id, next))
            }
            action={
              // On your own followers list the action is about them following
              // you, so it's Remove rather than a follow button.
              isOwn && kind === 'followers' ? (
                <RemoveFollowerButton
                  followerId={person.id}
                  onRemoved={() =>
                    setPeople((prev) => prev.filter((p) => p.id !== person.id))
                  }
                />
              ) : undefined
            }
          />
        ))}
      </div>
    </ListPageShell>
  )
}
