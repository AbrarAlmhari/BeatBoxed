import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock3, Loader2 } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'
import { arrival, endRecovery, inRecovery } from '@/lib/authLinks'
import { newPasswordProblem, PASSWORD_MIN } from '@/lib/passwords'

/**
 * Where the reset email's link lands. The link signs the user in (Supabase
 * does that as the app loads), so saving here is just setting the password.
 *
 * Without a working link (expired, already used, or no link at all, e.g.
 * the address typed by hand) it says the link has expired and offers a new
 * one.
 */
export default function ResetPassword() {
  const { session, loading, updatePassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [lostSession, setLostSession] = useState(false)

  const linkFailed = Boolean(arrival.errorCode)
  if (loading && !linkFailed) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />
      </div>
    )
  }
  if (linkFailed || lostSession || !session || !inRecovery()) return <LinkExpired />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = newPasswordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setPending(true)
    try {
      await updatePassword(password)
      endRecovery()
      navigate('/', { replace: true, state: { toast: 'Password updated' } })
    } catch (err) {
      const m = String((err as { message?: string } | null)?.message ?? '').toLowerCase()
      // The link's sign-in ran out while the page was open.
      if (m.includes('session') && (m.includes('missing') || m.includes('expired'))) setLostSession(true)
      else setError(authErrorMessage(err))
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={`For ${session.user.email}. Use at least ${PASSWORD_MIN} characters.`}
      footer={
        <Link to="/login" className="text-accent transition-colors duration-200 hover:text-foreground">
          Back to log in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          minLength={PASSWORD_MIN}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <TextField
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Type it again"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <div className="mt-1">
          <SubmitButton pending={pending}>{pending ? 'Saving…' : 'Save new password'}</SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}

function LinkExpired() {
  return (
    <AuthLayout
      title="This link has expired"
      subtitle="Reset links work once, and only for a while."
      footer={
        <Link to="/login" className="text-accent transition-colors duration-200 hover:text-foreground">
          Back to log in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 py-1 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary/15">
          <Clock3 className="size-7 text-accent" strokeWidth={1.75} />
        </span>
        <p className="text-body text-foreground">
          No problem: we can send you a new one. Use the newest email, since each new link replaces the last.
        </p>
        <Link
          to="/forgot-password"
          className="flex w-full items-center justify-center gap-2 rounded-button bg-primary px-4 py-3 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98]"
        >
          Send a new link
        </Link>
      </div>
    </AuthLayout>
  )
}
