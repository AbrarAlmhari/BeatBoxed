import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { TextField } from '@/components/auth/TextField'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { useAuth, WRONG_CURRENT_PASSWORD } from '@/lib/auth'
import { authErrorMessage } from '@/lib/authErrors'
import { newPasswordProblem, PASSWORD_MIN } from '@/lib/passwords'
import { useToast } from '@/lib/toast'

/**
 * Settings → Account: a button that opens the form in place. The current
 * password is checked first, so someone at an unlocked device can't change
 * it.
 */
export function ChangePassword() {
  const { changePassword } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function close() {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!current) {
      setError('Enter your current password.')
      return
    }
    const problem = newPasswordProblem(next, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setPending(true)
    try {
      await changePassword(current, next)
      close()
      toast.show({ message: 'Password updated' })
    } catch (err) {
      const message = (err as { message?: string } | null)?.message
      setError(message === WRONG_CURRENT_PASSWORD ? message : authErrorMessage(err))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-fit items-center gap-2 rounded-button border border-line-strong bg-surface-2 px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5"
      >
        <KeyRound className="size-4" strokeWidth={1.75} aria-hidden />
        Change password
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Change password"
      className="flex flex-col gap-4 rounded-button border border-white/5 p-4"
      noValidate
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <TextField
        label="Current password"
        type="password"
        name="current-password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextField
        label="New password"
        type="password"
        name="new-password"
        autoComplete="new-password"
        placeholder={`At least ${PASSWORD_MIN} characters`}
        required
        minLength={PASSWORD_MIN}
        value={next}
        onChange={(e) => setNext(e.target.value)}
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
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
        <div className="sm:w-56">
          <SubmitButton pending={pending}>{pending ? 'Saving…' : 'Save new password'}</SubmitButton>
        </div>
        <button
          type="button"
          onClick={close}
          className="min-h-11 rounded-button px-4 text-button text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
