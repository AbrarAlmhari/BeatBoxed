import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** A quiet note above a page's content: what's shown is fine, but there's a catch. */
export function StatusNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="animate-fade-in flex items-start gap-2.5 rounded-button bg-surface-2 px-3.5 py-3 text-secondary"
    >
      <AlertTriangle className="mt-px size-[18px] shrink-0 text-star" strokeWidth={2} aria-hidden />
      <span className="text-muted-foreground">{children}</span>
    </div>
  )
}
