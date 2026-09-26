import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'

export default function Login() {
  const { signIn, session, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!loading && session) {
    const to = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={to} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await signIn(email, password)
      navigate((location.state as { from?: string } | null)?.from ?? '/', {
        replace: true,
      })
    } catch (err) {
      setError(authErrorMessage(err))
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

        <div className="mt-1">
          <SubmitButton pending={pending}>
            {pending ? 'Logging in…' : 'Log in'}
          </SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}
