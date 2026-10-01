import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { BackButton } from '@/components/ui/BackButton'
import { FriendButton } from '@/components/people/FriendButton'
import { useAuth } from '@/lib/auth'
import { getFriendships } from '@/lib/catalog'
import type { FriendEdge } from '@/lib/types'

export default function FriendRequests() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<FriendEdge[] | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const { incoming } = await getFriendships(user.id)
    setRequests(incoming)
  }, [user])

  useEffect(() => {
    load().catch((err) => {
      console.error('[beatboxed] requests failed:', err)
      setRequests([])
    })
  }, [load])

  /** Drop the row immediately; the server call already happened in the button. */
  function handled(personId: string) {
    setRequests((prev) => (prev ?? []).filter((r) => r.person.id !== personId))
  }

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex items-center gap-2">
        <BackButton className="-ml-2" />
        <h1 className="text-page-title">Friend requests</h1>
      </div>

      {requests === null ? (
        <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading…
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-card-title">No pending requests.</p>
          <p className="max-w-sm text-body text-muted-foreground">
            Find people in Explore to send one.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((edge) => {
            const name = edge.person.displayName || edge.person.username || 'Listener'
            return (
              <div
                key={edge.person.id}
                className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
              >
                <Link to={`/profile/${edge.person.id}`} className="shrink-0">
                  {edge.person.avatarUrl ? (
                    <img
                      src={edge.person.avatarUrl}
                      alt=""
                      loading="lazy"
                      className="size-11 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </Link>

                <Link
                  to={`/profile/${edge.person.id}`}
                  className="flex min-w-0 flex-1 flex-col"
                >
                  <span dir="auto" className="truncate text-card-title">
                    {name}
                  </span>
                  {edge.person.username && (
                    <span className="truncate text-secondary text-muted-foreground">
                      @{edge.person.username}
                    </span>
                  )}
                </Link>

                {/* Shared with profiles and search, so Confirm and Delete
                    behave identically wherever a request appears. */}
                <FriendButton
                  personId={edge.person.id}
                  state="incoming"
                  size="sm"
                  onChange={() => handled(edge.person.id)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
