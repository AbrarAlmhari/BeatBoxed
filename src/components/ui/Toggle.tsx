import { cn } from '@/lib/cn'

/**
 * A labelled on/off switch for a setting that saves the moment it changes.
 *
 * It stays operable while a save is in flight — the optimistic state is the
 * feedback, and the page reverts it if the write fails. Disabling it mid-save
 * would make a row of switches feel sticky, which is the same mistake the
 * follow button used to make.
 */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  /** One plain line about what the setting actually does. */
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-foreground">{label}</span>
        {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-soft',
          checked ? 'bg-primary' : 'bg-surface-2'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white transition-all duration-200 ease-soft',
            checked ? 'start-[22px]' : 'start-0.5'
          )}
        />
      </button>
    </label>
  )
}
