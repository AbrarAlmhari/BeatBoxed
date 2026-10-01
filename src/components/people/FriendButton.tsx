import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Clock, UserCheck, UserPlus, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import {
  acceptFriendship,
  removeFriendship,
  requestFriendship,
} from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { FriendState } from '@/lib/types'

/**
 * The single friend control, shared by People search cards and the profile
 * header so the two can't drift apart.
 *
 *   none     -> Add friend
 *   outgoing -> Requested (tap to cancel)
 *   incoming -> Accept + Decline, two buttons
 *   friends  -> Friends, with a confirm before unfriending
 */
export function FriendButton({
  personId,
  state,
  onChange,
  size = 'md',
}: {
  personId: string
  state: FriendState
  onChange?: (next: FriendState) => void
  size?: 'sm' | 'md'
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [current, setCurrent] = useState<FriendState>(state)
  const [pending, setPending] = useState(false)
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false)

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

  function requireLogin() {
    navigate('/login', { state: { from: location.pathname } })
  }

  async function run(action: () => Promise<FriendState>, optimistic: FriendState) {
    const previous = current
    setCurrent(optimistic)
    setPending(true)
    try {
      const next = await action()
      setCurrent(next)
      onChange?.(next)
    } catch (err) {
      console.error('[beatboxed] friend action failed:', err)
      setCurrent(previous)
    } finally {
      setPending(false)
    }
  }

  function onAdd(e: React.MouseEvent) {
    swallow(e)
    if (!user) return requireLogin()
    // Comes back 'friends' when they'd already requested you.
    void run(() => requestFriendship(personId), 'outgoing')
  }

  function onCancel(e: React.MouseEvent) {
    swallow(e)
    if (!user) return requireLogin()
    void run(async () => {
      await removeFriendship(user.id, personId)
      return 'none'
    }, 'none')
  }

  function onAccept(e: React.MouseEvent) {
    swallow(e)
    if (!user) return requireLogin()
    void run(async () => {
      await acceptFriendship(personId, user.id)
      return 'friends'
    }, 'friends')
  }

  function onDecline(e: React.MouseEvent) {
    swallow(e)
    if (!user) return requireLogin()
    void run(async () => {
      await removeFriendship(user.id, personId)
      return 'none'
    }, 'none')
  }

  function onUnfriend(e: React.MouseEvent) {
    swallow(e)
    if (!user) return requireLogin()
    setConfirmingUnfriend(false)
    void run(async () => {
      await removeFriendship(user.id, personId)
      return 'none'
    }, 'none')
  }

  const neutral = cn(
    'flex shrink-0 items-center gap-1.5 rounded-button border border-white/10 bg-surface-2 text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground active:scale-[0.97] disabled:opacity-60',
    pad
  )
  const active = cn(
    'flex shrink-0 items-center gap-1.5 rounded-button border border-primary/60 bg-primary/15 text-foreground transition-colors duration-200 ease-soft active:scale-[0.97] disabled:opacity-60',
    pad
  )

  if (current === 'incoming') {
    return (
      <span className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onAccept} disabled={pending} className={active}>
          <UserCheck className="size-3.5" strokeWidth={2} />
          Accept
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={pending}
          className={cn(neutral, 'hover:text-danger')}
        >
          <X className="size-3.5" strokeWidth={2} />
          Decline
        </button>
      </span>
    )
  }

  if (current === 'friends') {
    // Unfriending isn't easily undone — the other person has to re-request.
    if (confirmingUnfriend) {
      return (
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onUnfriend}
            disabled={pending}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-button bg-danger/15 text-danger transition-colors duration-200 ease-soft hover:bg-danger/25 disabled:opacity-60',
              pad
            )}
          >
            Unfriend
          </button>
          <button
            type="button"
            onClick={(e) => {
              swallow(e)
              setConfirmingUnfriend(false)
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
          setConfirmingUnfriend(true)
        }}
        disabled={pending}
        className={active}
      >
        <Check className="size-3.5" strokeWidth={2} />
        Friends
      </button>
    )
  }

  if (current === 'outgoing') {
    return (
      <button type="button" onClick={onCancel} disabled={pending} className={neutral}>
        <Clock className="size-3.5" strokeWidth={2} />
        Requested
      </button>
    )
  }

  return (
    <button type="button" onClick={onAdd} disabled={pending} className={neutral}>
      <UserPlus className="size-3.5" strokeWidth={2} />
      Add friend
    </button>
  )
}
