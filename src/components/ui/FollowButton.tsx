import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { setArtistFollow } from '@/lib/catalog'
import { cn } from '@/lib/cn'

export function FollowButton({
  artistId,
  following,
  onChange,
  size = 'md',
}: {
  artistId: string
  following: boolean
  /** Lets the parent keep its own list in step without a refetch. */
  onChange?: (following: boolean) => void
  size?: 'sm' | 'md'
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isFollowing, setIsFollowing] = useState(following)
  const [pending, setPending] = useState(false)

  async function toggle(e: React.MouseEvent) {
    // These sit inside clickable cards; don't trigger the card's navigation.
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }

    const next = !isFollowing
    setIsFollowing(next)
    setPending(true)
    try {
      await setArtistFollow(user.id, artistId, next)
      onChange?.(next)
    } catch (err) {
      console.error('[beatboxed] follow failed:', err)
      setIsFollowing(!next)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFollowing}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-button border transition-colors duration-200 ease-soft active:scale-[0.97] disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1 text-meta' : 'px-3 py-1.5 text-button',
        isFollowing
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-white/10 bg-surface-2 text-muted-foreground hover:text-foreground'
      )}
    >
      {isFollowing ? (
        <Check className="size-3.5" strokeWidth={2} />
      ) : (
        <Plus className="size-3.5" strokeWidth={2} />
      )}
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}
