import { useState } from 'react'
import { BellOff, BellRing, MoreHorizontal, Share2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { MuteConfirm, type MuteTarget } from '@/components/mutes/MuteConfirm'
import { useAuth } from '@/lib/auth'
import { unmute, useMutedIds } from '@/lib/mutes'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * The profile's "⋯": Share profile, and on someone else's profile Mute or
 * Unmute. (Report profile needs a table of its own and is listed in
 * TASKS.md.) Share uses the phone's share sheet where there is one, and
 * copies the link otherwise.
 */
export function ProfileMenu({
  person,
  isOwn,
  className,
}: {
  person: MuteTarget
  isOwn: boolean
  className?: string
}) {
  const { user } = useAuth()
  const toast = useToast()
  const muted = useMutedIds(user?.id).has(person.id)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<MuteTarget | null>(null)
  const url = `${window.location.origin}/profile/${person.id}`
  const handle = person.username ? `@${person.username}` : person.name

  async function share() {
    setOpen(false)
    try {
      if (navigator.share) {
        await navigator.share({ title: `${person.name} on BeatBoxed`, url })
        return
      }
    } catch (err) {
      // Closing the share sheet isn't an error worth reporting.
      if ((err as Error).name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.show({ message: 'Profile link copied' })
    } catch {
      toast.show({ message: `Profile link: ${url}` })
    }
  }

  async function doUnmute() {
    setOpen(false)
    if (!user) return
    try {
      await unmute(user.id, person.id)
      toast.show({ message: `Unmuted ${handle}.` })
    } catch (err) {
      console.error('[beatboxed] unmute failed:', err)
      toast.show({ message: "Couldn't unmute. Try again." })
    }
  }

  const item = 'flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body hover:bg-white/5'

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-full bg-black/30 text-foreground backdrop-blur-md transition-colors duration-200 ease-soft hover:bg-black/45"
      >
        <MoreHorizontal className="size-5" strokeWidth={2} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Profile options" className="sm:w-56">
        <button type="button" onClick={() => void share()} className={item}>
          <Share2 className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          Share profile
        </button>
        {!isOwn &&
          (muted ? (
            <button type="button" onClick={() => void doUnmute()} className={item}>
              <BellRing className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              Unmute {handle}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setConfirming(person)
              }}
              className={item}
            >
              <BellOff className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              Mute {handle}
            </button>
          ))}
      </Sheet>
      <MuteConfirm target={confirming} onClose={() => setConfirming(null)} />
    </div>
  )
}
