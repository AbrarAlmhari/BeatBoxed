import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export function FormAlert({
  tone,
  children,
}: {
  tone: 'error' | 'success'
  children: ReactNode
}) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-fade-in flex items-start gap-2.5 rounded-button px-3.5 py-3 text-secondary',
        tone === 'error' ? 'bg-danger/10' : 'bg-success/10'
      )}
    >
      <Icon
        className={cn(
          'mt-px size-[18px] shrink-0',
          tone === 'error' ? 'text-danger' : 'text-success'
        )}
        strokeWidth={2}
      />
      <span className="text-foreground/90">{children}</span>
    </div>
  )
}
