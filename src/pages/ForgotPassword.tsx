import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { ResendEmail } from '@/components/auth/ResendConfirmation'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'

/**
 * Supabase sends at most one reset email per address a minute, so the
 * resend waits that long.
 */
const COOLDOWN_S = 60

/**
 * "Forgot password?": asks for the email and sends a reset link. The answer
 * is the same whether or not the address has an account.
 */
export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState(
    () => (location.state as { email?: string } | null)?.email ?? ''
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter the email you signed up with.')
      return
    }
    setPending(true)
    try {
      await sendPasswordReset(email)
      setSentTo(email.trim())
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setPending(false)
    }
  }

  const backToLogin = (
    <Link to="/login" className="text-accent transition-colors duration-200 hover:text-foreground">
      Back to log in
    </Link>
  )

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" subtitle="Your reset link is on its way." footer={backToLogin}>
        <div className="flex flex-col items-center gap-4 py-1 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-primary/15">
            <MailCheck className="size-7 text-accent" strokeWidth={1.75} />
          </span>
          <p className="text-body text-foreground">
            If an account exists for <b className="break-all">{sentTo}</b>, we've sent a reset link.
          </p>
          <p className="text-secondary text-muted-foreground">
            Open it on this phone or any other device to choose a new password. It can take a minute to arrive; check
            spam too.
          </p>
          <ResendEmail
            email={sentTo}
            send={sendPasswordReset}
            cooldownS={COOLDOWN_S}
            initialWaitS={COOLDOWN_S}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="inline-flex min-h-11 items-center text-secondary text-muted-foreground hover:text-foreground"
          >
            Wrong email? Go back
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={backToLogin}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="mt-1">
          <SubmitButton pending={pending}>{pending ? 'Sending…' : 'Send reset link'}</SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}
