import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'

export default function SignUp() {
  const { signUp, session, loading } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (!loading && session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setPending(true)
    try {
      const { needsEmailConfirmation } = await signUp({
        email,
        password,
        username,
        displayName,
      })
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
        subtitle={`We sent a confirmation link to ${sentTo}.`}
        footer={
          <Link
            to="/login"
            className="text-accent transition-colors duration-200 hover:text-foreground"
          >
            Back to log in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-success/10">
            <MailCheck className="size-6 text-success" strokeWidth={1.75} />
          </span>
          <p className="text-body text-muted-foreground">
            Click the link to activate your account, then come back and log in.
            It can take a minute to arrive — check spam too.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Rate, review, and build your library."
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
          label="Display name"
          name="displayName"
          autoComplete="name"
          placeholder="Sara A."
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          placeholder="sara"
          required
          pattern="[A-Za-z0-9_]+"
          hint="Letters, numbers, and underscores only."
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

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
          minLength={6}
          hint="At least 6 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="mt-1">
          <SubmitButton pending={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </SubmitButton>
        </div>
      </form>
    </AuthLayout>
  )
}
