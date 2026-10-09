import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Clock, UserPlus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { followUser, unfollowUser } from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { FollowState } from '@/lib/types'

/**
 * The single follow control for people, shared by People search, profile
 * headers, follower lists and suggestions so they can't drift apart.
 *
 *   none      -> Follow
 *   requested -> Requested (tap to cancel the request)
 *   following -> Following (tap, then confirm, to unfollow)
 *
 * Whether a follow lands as `following` or `requested` is decided by the
 * database from the account's privacy, so the optimistic state is only a
 * guess until the insert answers.
 */
export function UserFollowButton({
  personId,
  state,
  isPrivate = false,
  onChange,
  size = 'md',
}: {
  personId: string
  state: FollowState
  /** Best guess for the optimistic state; the database has the final say. */
  isPrivate?: boolean
  onChange?: (next: FollowState, previous: FollowState) => void
  size?: 'sm' | 'md'
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [current, setCurrent] = useState<FollowState>(state)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // The parent may resolve the real state after this mounted (the profile
  // header loads it asynchronously), so follow it until the user acts.
  useEffect(() => {
    setCurrent(state)
  }, [state])

  const pad = size === 'sm' ? 'px-2.5 py-1 text-meta' : 'px-3 py-1.5 text-button'

  /** Stops the tap from triggering the surrounding card link. */
  function swallow(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function run(action: () => Promise<FollowState>, optimistic: FollowState) {
    const previous = current
    setCurrent(optimistic)
    setPending(true)
    try {
      const next = await action()
      setCurrent(next)
      onChange?.(next, previous)
    } catch (err) {
      console.error('[beatboxed] follow action failed:', err)
      setCurrent(previous)
    } finally {
      setPending(false)
    }
  }

  function guard(e: React.MouseEvent): string | null {
    swallow(e)
    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return null
    }
    return user.id
  }

  function onFollow(e: React.MouseEvent) {
    const me = guard(e)
    if (!me) return
    void run(() => followUser(me, personId), isPrivate ? 'requested' : 'following')
  }

  function onRemove(e: React.MouseEvent) {
    const me = guard(e)
    if (!me) return
    setConfirming(false)
    void run(async () => {
      await unfollowUser(me, personId)
      return 'none'
    }, 'none')
  }

  const neutral = cn(
    'flex shrink-0 items-center gap-1.5 rounded-button border border-white/10 bg-surface-2 text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground active:scale-[0.97] disabled:opacity-60',
    pad
  )
  const primary = cn(
    'flex shrink-0 items-center gap-1.5 rounded-button bg-primary text-white transition-colors duration-200 ease-soft hover:bg-accent active:scale-[0.97] disabled:opacity-60',
    pad
  )
  const active = cn(
    'flex shrink-0 items-center gap-1.5 rounded-button border border-primary/60 bg-primary/15 text-foreground transition-colors duration-200 ease-soft active:scale-[0.97] disabled:opacity-60',
    pad
  )

  if (current === 'following') {
    // Unfollowing a private account isn't a tap to undo — getting back in
    // needs a new request and their approval — so it asks first.
    if (confirming) {
      return (
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-button bg-danger/15 text-danger transition-colors duration-200 ease-soft hover:bg-danger/25 disabled:opacity-60',
              pad
            )}
          >
            Unfollow
          </button>
          <button
            type="button"
            onClick={(e) => {
              swallow(e)
              setConfirming(false)
            }}
            className={cn('shrink-0 rounded-button text-muted-foreground hover:text-foreground', pad)}
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
        disabled={pending}
        className={active}
      >
        <Check className="size-3.5" strokeWidth={2} />
        Following
      </button>
    )
  }

  if (current === 'requested') {
    return (
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        aria-label="Requested, tap to cancel the request"
        className={neutral}
      >
        <Clock className="size-3.5" strokeWidth={2} />
        Requested
      </button>
    )
  }

  return (
    <button type="button" onClick={onFollow} disabled={pending} className={primary}>
      <UserPlus className="size-3.5" strokeWidth={2} />
      Follow
    </button>
  )
}
