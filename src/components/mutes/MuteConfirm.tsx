import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, EyeOff, Loader2, MessageSquare, Shield } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { PersonAvatar } from '@/components/conversations/PersonAvatar'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { mute } from '@/lib/mutes'

export type MuteTarget = {
  id: string
  username: string | null
  name: string
  avatarUrl: string | null
}

const LINES = [
  { icon: EyeOff, text: "Their reviews won't show in your feeds or Explore." },
  { icon: MessageSquare, text: 'Their comments are folded away. You can still tap to read one.' },
  { icon: BellOff, text: "You won't get notifications from them." },
  { icon: Shield, text: "They won't be told, and you still follow each other." },
]

/**
 * "Mute Toji?": what muting does, in four lines, then Mute or Cancel.
 * Opened from a profile's ⋯ and from the ⋯ on a review or comment.
 */
export function MuteConfirm({
  target,
  onClose,
  onMuted,
}: {
  target: MuteTarget | null
  onClose: () => void
  onMuted?: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const titleId = useId()
  const [pending, setPending] = useState(false)

  async function confirm() {
    if (!user || !target) return
    setPending(true)
    try {
      await mute(user.id, target.id)
      onClose()
      onMuted?.()
      const handle = target.username ? `@${target.username}` : target.name
      toast.show({
        icon: <BellOff className="size-5" strokeWidth={1.75} aria-hidden />,
        message: `Muted ${handle}. Manage muted accounts in Settings.`,
        actionLabel: 'Settings',
        onAction: () => navigate('/settings/muted'),
      })
    } catch (err) {
      console.error('[beatboxed] mute failed:', err)
      toast.show({ message: "Couldn't mute. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={target !== null} onClose={onClose} labelledBy={titleId}>
      {target && (
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <PersonAvatar name={target.name} url={target.avatarUrl} className="size-12 text-card-title" />
            <h2 id={titleId} dir="auto" className="text-section-title">
              Mute {target.name}?
            </h2>
          </div>
          <ul className="flex flex-col gap-3">
            {LINES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-body text-foreground/85">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={pending}
              className="flex min-h-12 items-center justify-center gap-2 rounded-chip bg-primary text-button text-white transition-colors duration-200 ease-soft hover:bg-accent disabled:opacity-60"
            >
              {pending && <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />}
              Mute
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-12 rounded-chip bg-surface-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
