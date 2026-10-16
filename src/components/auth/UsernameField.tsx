import { useId } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { USERNAME_MAX, USERNAME_MESSAGES, USERNAME_RULE, type UsernameStatus } from '@/lib/username'

/**
 * The username field for sign-up and Edit profile: the rule under the
 * field, and a live message as you type (too short, wrong characters,
 * taken, available). What's typed is lowercased as it goes, because that's
 * how usernames are stored.
 */
export function UsernameField({
  value,
  onChange,
  status,
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (next: string) => void
  status: UsernameStatus
  disabled?: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  const name = value.trim()
  const bad = status.state === 'invalid' || status.state === 'taken'

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary font-medium">
        Username
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-muted-foreground">
          @
        </span>
        <input
          id={id}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="sara.music"
          maxLength={USERNAME_MAX + 5}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-rule ${id}-status`}
          className={cn(
            'w-full rounded-button border bg-surface-2 py-2.5 pl-8 pr-3.5 text-body text-foreground transition-colors duration-200 ease-soft',
            'placeholder:text-muted-foreground/70 hover:border-white/10 focus:outline-none focus:ring-2 disabled:opacity-60',
            bad
              ? 'border-danger/60 focus:border-danger/70 focus:ring-danger/25'
              : 'border-white/5 focus:border-primary/60 focus:ring-primary/25'
          )}
        />
      </div>
      <p id={`${id}-rule`} className="text-meta text-muted-foreground">
        {USERNAME_RULE}
      </p>
      <p
        id={`${id}-status`}
        role="status"
        aria-live="polite"
        className={cn(
          'flex min-h-4 items-center gap-1.5 text-meta',
          bad && 'text-danger',
          status.state === 'available' && 'text-success',
          status.state === 'checking' && 'text-muted-foreground'
        )}
      >
        {status.state === 'checking' && (
          <>
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
            Checking…
          </>
        )}
        {status.state === 'available' && (
          <>
            <Check className="size-3.5" strokeWidth={2.5} aria-hidden />@{name} is available
          </>
        )}
        {status.state === 'taken' && (
          <>
            <X className="size-3.5" strokeWidth={2.5} aria-hidden />
            {USERNAME_MESSAGES.taken}
          </>
        )}
        {status.state === 'invalid' && (
          <>
            <X className="size-3.5" strokeWidth={2.5} aria-hidden />
            {USERNAME_MESSAGES[status.problem]}
          </>
        )}
      </p>
    </div>
  )
}
