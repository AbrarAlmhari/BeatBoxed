import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean
  children: ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-button bg-primary px-4 py-3 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
    >
      {pending && (
        <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
      )}
      {children}
    </button>
  )
}
