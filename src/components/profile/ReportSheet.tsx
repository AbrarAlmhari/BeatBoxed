import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { REPORT_REASONS, reportProfile, type ReportReason } from '@/lib/reports'
import { cn } from '@/lib/cn'

/**
 * Report a profile: pick a reason, add a few words if you want, send. The
 * person isn't told. Reports go to the team (profile_reports, 0050).
 */
export function ReportSheet({
  target,
  onClose,
}: {
  target: { id: string; handle: string } | null
  onClose: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const titleId = useId()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    setReason(null)
    setDetails('')
    setError(null)
  }, [target])

  async function send() {
    if (!user || !target || !reason) return
    setPending(true)
    setError(null)
    try {
      const result = await reportProfile(user.id, target.id, reason, details)
      onClose()
      toast.show({ message: result === 'already' ? "You've already reported this profile. We'll take a look." : "Thanks, we'll take a look" })
    } catch (err) {
      console.error('[beatboxed] report failed:', err)
      setError("Couldn't send the report. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={target !== null} onClose={onClose} labelledBy={titleId}>
      <div className="flex flex-col gap-4 px-5 pb-5 pt-3 sm:pt-5">
        <div className="flex items-start gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-section-title">
              Report <span dir="auto">{target?.handle}</span>
            </h2>
            <p className="text-secondary text-muted-foreground">They won't know who reported them.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Why are you reporting this profile?</legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-button px-3 text-body transition-colors duration-200 ease-soft hover:bg-white/5',
                reason === r.id && 'bg-primary/15'
              )}
            >
              <input
                type="radio"
                name="report-reason"
                value={r.id}
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
                className="size-4 accent-[var(--color-primary)]"
              />
              {r.label}
            </label>
          ))}
        </fieldset>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={500}
          rows={3}
          dir="auto"
          aria-label="Anything else we should know (optional)"
          placeholder="Anything else we should know? (optional)"
          className="w-full resize-none rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25"
        />

        {error && <p role="alert" className="text-secondary text-danger">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-button bg-surface-2 px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!reason || pending}
            className="min-h-11 flex-1 rounded-button bg-danger/80 px-4 text-button text-white transition-colors duration-200 ease-soft hover:bg-danger disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
