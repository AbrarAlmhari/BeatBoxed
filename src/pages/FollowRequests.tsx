import { useCallback, useEffect, useState } from 'react'
import { EmptyState, emptySecondaryActionClass } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
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
        <EmptyState
          face="sad"
          tone="error"
          title="Couldn't load your requests."
          action={
            <button type="button" onClick={() => void load()} className={emptySecondaryActionClass}>
              Retry
            </button>
          }
        />
      ) : requests === null ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <SkeletonList rows={3} cover="size-11 rounded-full" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          face="sleepy-sticker"
          title="No pending requests."
          detail="When your account is private, people who want to follow you show up here for you to approve."
        />
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
