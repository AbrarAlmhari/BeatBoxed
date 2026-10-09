import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PersonCard } from '@/components/people/PersonCard'
import { FollowRequestActions } from '@/components/people/FollowerActions'
import { useAuth } from '@/lib/auth'
import { getFollowRequests } from '@/lib/catalog'
import type { FollowRequest } from '@/lib/types'

/**
 * People asking to follow the viewer. Only a private account ever has any:
 * following a public account is accepted on insert, and going public accepts
 * whatever was waiting.
 */
export default function FollowRequests() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<FollowRequest[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setError(false)
    setRequests(null)
    try {
      setRequests(await getFollowRequests(user.id))
    } catch (err) {
      console.error('[beatboxed] follow requests failed:', err)
      setError(true)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  /** Drop the row immediately; the server call already happened in the buttons. */
  function handled(personId: string) {
    setRequests((prev) => (prev ?? []).filter((r) => r.person.id !== personId))
  }

  return (
    <div className="flex flex-col gap-6 pt-2">
      <h1 className="text-page-title">Follow requests</h1>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-body text-danger">Couldn't load your requests.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-button bg-surface-2 px-4 py-2 text-button text-foreground hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      ) : requests === null ? (
        <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading…
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-card-title">No pending requests.</p>
          <p className="max-w-sm text-body text-muted-foreground">
            When your account is private, people who want to follow you show
            up here for you to approve.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((r) => (
            <PersonCard
              key={r.person.id}
              person={r.person}
              state="none"
              action={
                <FollowRequestActions
                  followerId={r.person.id}
                  onDone={() => handled(r.person.id)}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
