import type { ReactNode } from 'react'
import { BeatieImage, type BeatieMood, type BeatieSticker } from '@/components/beatie/BeatieImage'
import { Card } from './Card'
import { cn } from '@/lib/cn'

/**
 * Nothing to show: Beatie, a line of text and at most one action. Stickers
 * are 96px, as src/assets/beatie/README.md allows for empty states; plain
 * faces 64px. `compact` is for small spaces (a rail, a sheet): less padding.
 *
 * The one action uses emptyActionClass (primary), or pass any element.
 */
export function EmptyState({
  face = 'sleepy-sticker',
  title,
  detail,
  action,
  compact = false,
  tone = 'default',
  className,
}: {
  face?: BeatieSticker | BeatieMood | null
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  compact?: boolean
  /** "error" colours the title for a failed load (pair with a Retry action). */
  tone?: 'default' | 'error'
  className?: string
}) {
  const sticker = face?.endsWith('-sticker')
  return (
    <Card
      padding="none"
      shadow={false}
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        compact ? 'px-5 py-7' : 'px-6 py-10',
        className
      )}
    >
      {face && <BeatieImage mood={face} size={sticker ? 96 : 64} />}
      <p dir="auto" className={cn('text-card-title', tone === 'error' && 'text-danger')}>
        {title}
      </p>
      {detail && <p className="max-w-sm text-body text-muted-foreground">{detail}</p>}
      {action}
    </Card>
  )
}

/** The one action an empty state offers, in the primary style. */
export const emptyActionClass =
  'mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-primary px-4 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98]'

/** A quieter action (Retry, Clear filters): secondary style. */
export const emptySecondaryActionClass =
  'mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-button border border-line-strong bg-surface-2 px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10'
