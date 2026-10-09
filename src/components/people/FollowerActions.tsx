import { useState } from 'react'
import { UserCheck, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { acceptFollowRequest, removeFollower } from '@/lib/catalog'
import { cn } from '@/lib/cn'

const base =
  'flex shrink-0 items-center gap-1.5 rounded-button px-2.5 py-1 text-meta transition-colors duration-200 ease-soft active:scale-[0.97] disabled:opacity-60'
const neutral = cn(base, 'border border-white/10 bg-surface-2 text-muted-foreground hover:text-foreground')

/**
 * Accept or decline someone's request to follow the viewer. Separate from
 * UserFollowButton because it acts on the other direction: their row
 * pointing at you, not yours pointing at them.
 */
export function FollowRequestActions({
  followerId,
  onDone,
}: {
  followerId: string
  onDone: (accepted: boolean) => void
}) {
  const { user } = useAuth()
  const [pending, setPending] = useState(false)

  async function act(accept: boolean, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return
    setPending(true)
    try {
      if (accept) await acceptFollowRequest(followerId, user.id)
      else await removeFollower(user.id, followerId)
      onDone(accept)
    } catch (err) {
      console.error('[beatboxed] follow request action failed:', err)
      setPending(false)
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={(e) => void act(true, e)}
        disabled={pending}
        className={cn(base, 'bg-primary text-white hover:bg-accent')}
      >
        <UserCheck className="size-3.5" strokeWidth={2} />
        Accept
      </button>
      <button
        type="button"
        onClick={(e) => void act(false, e)}
        disabled={pending}
        className={cn(neutral, 'hover:text-danger')}
      >
        <X className="size-3.5" strokeWidth={2} />
        Decline
      </button>
    </span>
  )
}

/**
 * Remove someone from your own followers, with the same two-step confirm the
 * unfollow uses. On a private account this is how you revoke access.
 */
export function RemoveFollowerButton({
  followerId,
  onRemoved,
}: {
  followerId: string
  onRemoved: () => void
}) {
  const { user } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)

  function swallow(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function remove(e: React.MouseEvent) {
    swallow(e)
    if (!user) return
    setPending(true)
    try {
      await removeFollower(user.id, followerId)
      onRemoved()
    } catch (err) {
      console.error('[beatboxed] remove follower failed:', err)
      setPending(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => void remove(e)}
          disabled={pending}
          className={cn(base, 'bg-danger/15 text-danger hover:bg-danger/25')}
        >
          Remove follower
        </button>
        <button
          type="button"
          onClick={(e) => {
            swallow(e)
            setConfirming(false)
          }}
          className="shrink-0 rounded-button px-2.5 py-1 text-meta text-muted-foreground hover:text-foreground"
        >
          Keep
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        swallow(e)
        setConfirming(true)
      }}
      className={neutral}
    >
      Remove
    </button>
  )
}
