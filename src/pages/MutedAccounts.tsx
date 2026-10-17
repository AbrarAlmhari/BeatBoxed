import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { PersonAvatar } from '@/components/conversations/PersonAvatar'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { getMutedAccounts, mute, mutedAgo, unmute, type MutedAccount } from '@/lib/mutes'
import { cn } from '@/lib/cn'

/**
 * Settings → Muted accounts. Unmute keeps the row (as "Mute") until you
 * leave, so a slip of the finger is one tap to undo.
 */
export default function MutedAccounts() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<MutedAccount[] | null>(null)
  const [unmuted, setUnmuted] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    getMutedAccounts(user.id)
      .then(setRows)
      .catch((err) => {
        console.error('[beatboxed] muted accounts failed:', err)
        setRows([])
      })
  }, [user])

  async function toggle(row: MutedAccount) {
    if (!user) return
    const isMuted = !unmuted.has(row.id)
    const flip = (on: boolean) =>
      setUnmuted((s) => {
        const n = new Set(s)
        if (on) n.add(row.id)
        else n.delete(row.id)
        return n
      })
    flip(isMuted)
    try {
      if (isMuted) await unmute(user.id, row.id)
      else await mute(user.id, row.id)
    } catch (err) {
      console.error('[beatboxed] mute toggle failed:', err)
      flip(!isMuted)
      toast.show({ message: "Couldn't save that. Try again." })
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4 pt-2">
      {/* The app's top bar has the back arrow. */}
      <h1 className="text-page-title">Muted accounts</h1>
      <p className="text-body text-muted-foreground">
        You don't see their reviews, comments or notifications. They aren't told, and follows stay as they are.
      </p>

      {rows === null ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <SkeletonList rows={3} cover="size-12 rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          face="happy-sticker"
          title="You haven't muted anyone"
          detail="Mute someone from the ⋯ on their profile, a review or a comment. They won't be told."
        />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Muted accounts">
          {rows.map((r) => {
            const name = r.displayName || r.username || 'Someone'
            const isMuted = !unmuted.has(r.id)
            return (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <Link to={`/profile/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <PersonAvatar name={name} url={r.avatarUrl} className="size-12 text-card-title" />
                  <span className="flex min-w-0 flex-col">
                    <span dir="auto" className="truncate text-card-title">
                      {name}
                    </span>
                    <span className="text-secondary text-muted-foreground">
                      {r.username && `@${r.username} · `}
                      {isMuted ? `muted ${mutedAgo(r.mutedAt)}` : 'not muted'}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void toggle(r)}
                  aria-pressed={isMuted}
                  aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${name}`}
                  className={cn(
                    'min-h-11 shrink-0 rounded-chip px-5 text-button transition-colors duration-200 ease-soft',
                    isMuted
                      ? 'bg-primary/25 text-accent hover:bg-primary/35'
                      : 'border border-line-strong text-foreground hover:bg-white/5'
                  )}
                >
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
