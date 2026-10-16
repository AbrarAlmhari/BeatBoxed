import { useEffect, useState } from 'react'
import { Loader2, MailCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'
import { cn } from '@/lib/cn'

/** Supabase limits how often a confirmation email can be resent. */
const COOLDOWN_S = 30

/**
 * "Resend email": sends the confirmation link again, then waits before it
 * can be tapped again, saying when it was sent.
 */
export function ResendConfirmation({ email, className }: { email: string; className?: string }) {
  const { resendConfirmation } = useAuth()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function send() {
    setState('sending')
    setMessage(null)
    try {
      await resendConfirmation(email)
      setState('sent')
      setWait(COOLDOWN_S)
    } catch (err) {
      setState('error')
      setMessage(authErrorMessage(err))
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === 'sending' || wait > 0 || !email.trim()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-chip border border-line-strong px-5 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-60"
      >
        {state === 'sending' && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />}
        {wait > 0 ? `Resend email (${wait}s)` : 'Resend email'}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-meta">
        {state === 'sent' && (
          <span className="flex items-center gap-1.5 text-success">
            <MailCheck className="size-3.5" strokeWidth={2} aria-hidden />
            Sent again to {email.trim()}.
          </span>
        )}
        {state === 'error' && <span className="text-danger">{message}</span>}
      </p>
    </div>
  )
}
