import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PersonCard } from './PersonCard'
import { getFriendships } from '@/lib/catalog'
import type { FriendEdge } from '@/lib/types'

/** Own-profile only: incoming requests, outgoing requests, and friends. */
export function FriendsPanel({
  viewerId,
  onCountChange,
}: {
  viewerId: string
  onCountChange?: (accepted: number) => void
}) {
  const [data, setData] = useState<{
    incoming: FriendEdge[]
    outgoing: FriendEdge[]
    friends: FriendEdge[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    getFriendships(viewerId)
      .then((d) => {
        if (cancelled) return
        setData(d)
        onCountChange?.(d.friends.length)
      })
      .catch((err) => {
        console.error('[beatboxed] friendships failed:', err)
        if (!cancelled) setData({ incoming: [], outgoing: [], friends: [] })
      })
    return () => {
      cancelled = true
    }
    // onCountChange is a fresh closure each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId])

  /** Any action can move someone between lists, so just re-read. */
  function refresh() {
    getFriendships(viewerId)
      .then((d) => {
        setData(d)
        onCountChange?.(d.friends.length)
      })
      .catch((err) => console.error('[beatboxed] friendships refresh failed:', err))
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
        Loading friends…
      </div>
    )
  }

  const empty =
    data.incoming.length === 0 &&
    data.outgoing.length === 0 &&
    data.friends.length === 0

  if (empty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
        <p className="text-card-title">No friends yet</p>
        <p className="max-w-sm text-body text-muted-foreground">
          Find people in Explore and send a request.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Group title="Requests received" edges={data.incoming} onChanged={refresh} />
      <Group title="Requests sent" edges={data.outgoing} onChanged={refresh} />
      <Group title="Friends" edges={data.friends} onChanged={refresh} />
    </div>
  )
}

function Group({
  title,
  edges,
  onChanged,
}: {
  title: string
  edges: FriendEdge[]
  onChanged: () => void
}) {
  if (edges.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-section-title">
        {title}{' '}
        <span className="text-secondary text-muted-foreground">
          ({edges.length})
        </span>
      </h3>
      {edges.map((e) => (
        <PersonCard
          key={e.person.id}
          person={e.person}
          state={e.state}
          onStateChange={onChanged}
        />
      ))}
    </section>
  )
}
