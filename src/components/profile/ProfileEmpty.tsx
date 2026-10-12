import type { ReactNode } from 'react'
import { BeatieImage, type BeatieMood, type BeatieSticker } from '@/components/beatie/BeatieImage'

/**
 * An empty tab: Beatie, a line of text and at most one action. Stickers are
 * used at 96px, as the README allows for empty states.
 */
export function ProfileEmpty({
  face,
  title,
  detail,
  action,
}: {
  face: BeatieSticker | BeatieMood
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center">
      <BeatieImage mood={face} size={96} />
      <p dir="auto" className="text-card-title">
        {title}
      </p>
      {detail && <p className="max-w-sm text-body text-muted-foreground">{detail}</p>}
      {action}
    </div>
  )
}

/** The one action an empty state offers, in the primary style. */
export const emptyActionClass =
  'mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-primary px-4 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98]'
