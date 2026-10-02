import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Loader2, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useFollows } from '@/lib/follows'
import { cn } from '@/lib/cn'

/**
 * Follow state comes from the shared FollowsProvider, so a follow made on one
 * song shows on every other song by that artist, in Explore, and on the
 * Profile and Library lists — with no per-page fetching.
 *
 * The button stays usable: only the very first load shows a spinner, and a
 * failed load becomes a retry rather than a dead control. An earlier version
 * disabled it on `!ready`, which made a stalled load look like a broken app.
 */
export function FollowButton({
  artistId,
  onChange,
  size = 'md',
}: {
  artistId: string
  /** Fires with the settled value, for lists that drop a row on unfollow. */
  onChange?: (following: boolean) => void
  size?: 'sm' | 'md'
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { isFollowing, loading, error, retry, toggleFollow } = useFollows()
  const [writeFailed, setWriteFailed] = useState(false)

  const following = isFollowing(artistId)
  const pad = size === 'sm' ? 'px-2.5 py-1 text-meta' : 'px-3 py-1.5 text-button'

  async function onClick(e: React.MouseEvent) {
    // These sit inside clickable cards; don't trigger the card's navigation.
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }
    if (error && !following) {
      // The set never loaded, so the displayed state can't be trusted.
      retry()
      return
    }

    setWriteFailed(false)
    try {
      // Keep the call on its own line. `onChange?.(await toggleFollow(id))`
      // looks equivalent but is not: optional invocation short-circuits
      // before evaluating its arguments, so when no onChange was passed —
      // the Song page and Explore both omit it — the toggle never ran at
      // all. The click did nothing, silently, with no request and no error.
      const settled = await toggleFollow(artistId)
      onChange?.(settled)
    } catch {
      setWriteFailed(true)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      aria-label={
        writeFailed
          ? 'Follow failed, tap to retry'
          : following
            ? 'Unfollow this artist'
            : 'Follow this artist'
      }
      title={writeFailed ? "That didn't save. Tap to try again." : undefined}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-button border transition-colors duration-200 ease-soft active:scale-[0.97]',
        pad,
        writeFailed
          ? 'border-danger/60 bg-danger/10 text-danger'
          : following
            ? 'border-primary/60 bg-primary/15 text-foreground'
            : 'border-white/10 bg-surface-2 text-muted-foreground hover:text-foreground'
      )}
    >
      {/* Only the initial load spins. A write in flight shows nothing: the
          label has already flipped, and that is the feedback. */}
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
      ) : writeFailed ? (
        <AlertCircle className="size-3.5" strokeWidth={2} />
      ) : following ? (
        <Check className="size-3.5" strokeWidth={2} />
      ) : (
        <Plus className="size-3.5" strokeWidth={2} />
      )}
      {writeFailed ? 'Retry' : following ? 'Following' : 'Follow'}
    </button>
  )
}
