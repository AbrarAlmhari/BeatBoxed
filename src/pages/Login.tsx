import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'
import { ResendConfirmation } from '@/components/auth/ResendConfirmation'

export default function Login() {
  const { signIn, session, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Signed up but never clicked the link: say so, and offer to resend it.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null)

  if (!loading && session) {
    const to = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={to} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setUnconfirmed(null)
    setPending(true)
    try {
      await signIn(email, password)
      navigate((location.state as { from?: string } | null)?.from ?? '/', {
        replace: true,
      })
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      const text = String((err as { message?: string } | null)?.message ?? '').toLowerCase()
      if (code === 'email_not_confirmed' || text.includes('email not confirmed')) {
        setUnconfirmed(email.trim())
      } else {
        setError(authErrorMessage(err))
      }
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link
            to="/signup"
            className="text-accent transition-colors duration-200 hover:text-foreground"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {unconfirmed && (
          <div className="flex flex-col gap-3">
            <FormAlert tone="error">
              Confirm your email first. We sent a link to {unconfirmed}; open it to finish signing up.
            </FormAlert>
            <ResendConfirmation email={unconfirmed} />
          </div>
        )}

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
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Link
          to="/forgot-password"
          state={{ email: email.trim() }}
          className="-mt-2 inline-flex min-h-11 w-fit items-center self-end text-secondary text-accent transition-colors duration-200 hover:text-foreground"
        >
          Forgot password?
        </Link>

        <div className="mt-1">
          <SubmitButton pending={pending}>
            {pending ? 'Logging in…' : 'Log in'}
          </SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}
