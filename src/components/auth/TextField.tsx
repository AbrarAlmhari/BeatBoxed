import { useId, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}

export function TextField({ label, hint, className, ...props }: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const isPassword = props.type === 'password'
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary font-medium">
        {label}
      </label>

      <div className="relative">
        <input
          {...props}
          id={id}
          type={isPassword && revealed ? 'text' : props.type}
          aria-describedby={hintId}
          className={cn(
            'w-full rounded-button bg-surface-2 px-3.5 py-2.5 text-body text-foreground',
            'placeholder:text-muted-foreground/70',
            'border border-white/5 transition-colors duration-200 ease-soft',
            'hover:border-white/10 focus:border-primary/60 focus:outline-none',
            'focus:ring-2 focus:ring-primary/25',
            isPassword && 'pr-11',
            className
          )}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-button text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            {revealed ? (
              <EyeOff className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <Eye className="size-[18px]" strokeWidth={1.75} />
            )}
          </button>
        )}
      </div>

      {hint && (
        <p id={hintId} className="text-meta text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
