import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Clock, UserCheck, UserPlus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import {
  acceptFriendship,
  removeFriendship,
  requestFriendship,
} from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { FriendState } from '@/lib/types'

/**
 * One button, four states. Tapping cycles the sensible action for each:
 * none -> request, outgoing -> cancel, incoming -> accept, friends -> unfriend.
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

  async function act(e: React.MouseEvent) {
    // Sits inside a link to the person's profile; don't navigate on tap.
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }

    const previous = current
    // Optimistic: assume the obvious outcome, correct it if the server differs.
    const optimistic: FriendState =
      previous === 'none'
        ? 'outgoing'
        : previous === 'incoming'
          ? 'friends'
          : 'none'
    setCurrent(optimistic)
    setPending(true)

    try {
      let next: FriendState = optimistic
      if (previous === 'none') {
        // May come back as 'friends' when they'd already requested you.
        next = await requestFriendship(personId)
      } else if (previous === 'incoming') {
        await acceptFriendship(personId, user.id)
        next = 'friends'
      } else {
        await removeFriendship(user.id, personId)
        next = 'none'
      }
      setCurrent(next)
      onChange?.(next)
    } catch (err) {
      console.error('[beatboxed] friend action failed:', err)
      setCurrent(previous)
    } finally {
      setPending(false)
    }
  }

  const look = {
    none: { label: 'Add friend', Icon: UserPlus, active: false },
    outgoing: { label: 'Requested', Icon: Clock, active: false },
    incoming: { label: 'Accept', Icon: UserCheck, active: true },
    friends: { label: 'Friends', Icon: Check, active: true },
  }[current]

  return (
    <button
      type="button"
      onClick={act}
      disabled={pending}
      aria-label={`${look.label} — ${personId}`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-button border transition-colors duration-200 ease-soft active:scale-[0.97] disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1 text-meta' : 'px-3 py-1.5 text-button',
        look.active
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-white/10 bg-surface-2 text-muted-foreground hover:text-foreground'
      )}
    >
      <look.Icon className="size-3.5" strokeWidth={2} />
      {look.label}
    </button>
  )
}
