import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'
import { ResendConfirmation } from '@/components/auth/ResendConfirmation'

/** As the sign-up mockup says. */
const PASSWORD_MIN = 8

export default function SignUp() {
  const { signUp, session, loading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (!loading && session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`)
      return
    }

    setPending(true)
    try {
      // Username, display name and the rest come next, in setup.
      const { needsEmailConfirmation } = await signUp({ email, password })
      // Email confirmation is on for this project, so there's no session yet —
      // the profiles row is created by the on_auth_user_created trigger.
      if (needsEmailConfirmation) {
        setSentTo(email.trim())
      }
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setPending(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="One more step before we set up your profile."
        footer={
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="inline-flex min-h-11 items-center text-accent transition-colors duration-200 hover:text-foreground"
          >
            Wrong email? Go back
          </button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-1 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-primary/15">
            <MailCheck className="size-7 text-accent" strokeWidth={1.75} />
          </span>
          <p className="text-body text-foreground">
            We sent a confirmation link to <b className="break-all">{sentTo}</b>.
          </p>
          <p className="text-secondary text-muted-foreground">
            Open it on this phone or any other device and you'll go straight to setting up your profile. It can take a
            minute to arrive; check spam too.
          </p>
          <ResendConfirmation email={sentTo} className="w-full" />
          <Link to="/login" className="inline-flex min-h-11 items-center text-secondary text-muted-foreground hover:text-foreground">
            Already confirmed? Log in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Rate songs, write reviews, and see what your friends are listening to."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-accent transition-colors duration-200 hover:text-foreground"
          >
            Log in
          </Link>
        </>
      }
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

        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
          minLength={PASSWORD_MIN}
          hint={`At least ${PASSWORD_MIN} characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="mt-1">
          <SubmitButton
            pending={pending}
          >
            {pending ? 'Creating account…' : 'Create account'}
          </SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}
