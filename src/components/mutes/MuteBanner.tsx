import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { unmute, useMutedIds } from '@/lib/mutes'
import { useToast } from '@/lib/toast'

/**
 * On a muted person's profile: "You muted @name. Only you can see this."
 * with Unmute. After unmuting it says so in green for a moment.
 */
export function MuteBanner({ personId, handle }: { personId: string; handle: string }) {
  const { user } = useAuth()
  const toast = useToast()
  const muted = useMutedIds(user?.id).has(personId)
  const [justUnmuted, setJustUnmuted] = useState(false)
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // Muted again from the menu: the green line gives way to the banner.
  useEffect(() => {
    if (muted) setJustUnmuted(false)
  }, [muted])

  async function doUnmute() {
    if (!user) return
    setPending(true)
    try {
      await unmute(user.id, personId)
      setJustUnmuted(true)
      timer.current = setTimeout(() => setJustUnmuted(false), 6000)
    } catch (err) {
      console.error('[beatboxed] unmute failed:', err)
      toast.show({ message: "Couldn't unmute. Try again." })
    } finally {
      setPending(false)
    }
  }

  if (justUnmuted) {
    return (
      <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-body font-semibold text-success">
        Unmuted. Their posts will show again.
      </p>
    )
  }
  if (!muted) return null
  return (
    <div className="flex items-center gap-3 rounded-card border border-line-strong bg-surface-2 px-4 py-2.5">
      <p className="min-w-0 flex-1 text-body text-foreground">
        You muted <span className="font-semibold">{handle}</span>.{' '}
        <span className="text-muted-foreground">Only you can see this.</span>
      </p>
      <button
        type="button"
        onClick={() => void doUnmute()}
        disabled={pending}
        className="min-h-10 shrink-0 rounded-chip bg-primary/25 px-4 text-button text-accent transition-colors duration-200 ease-soft hover:bg-primary/35 disabled:opacity-60"
      >
        Unmute
      </button>
    </div>
  )
}
