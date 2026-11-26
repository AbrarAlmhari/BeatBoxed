import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** A quiet note above a page's content: what's shown is fine, but there's a catch. */
export function StatusNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="animate-fade-in flex items-start gap-2.5 rounded-tile border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-3 py-2.5 text-[12.5px] leading-snug"
    >
      <AlertTriangle className="mt-px size-[18px] shrink-0 text-[#fbbf24]" strokeWidth={2} aria-hidden />
      <span className="text-[#fde68a]">{children}</span>
    </div>
  )
}
