import { useState } from 'react'
import { MoreHorizontal, Share2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * The profile's "⋯": Share profile. (Report profile needs a table of its
 * own and is listed in TASKS.md.) Uses the phone's share sheet where there
 * is one, and copies the link otherwise.
 */
export function ProfileMenu({
  profileId,
  name,
  className,
}: {
  profileId: string
  name: string
  className?: string
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const url = `${window.location.origin}/profile/${profileId}`

  async function share() {
    setOpen(false)
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} on BeatBoxed`, url })
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
        <button
          type="button"
          onClick={() => void share()}
          className="flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body hover:bg-white/5"
        >
          <Share2 className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          Share profile
        </button>
      </Sheet>
    </div>
  )
}
