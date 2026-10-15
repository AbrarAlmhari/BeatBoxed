import { cn } from '@/lib/cn'
import { Card } from './Card'

/** What the shape sits on, so it's one step lighter than that. */
export type SkeletonTone = 'card' | 'page' | 'inset'

const TONE: Record<SkeletonTone, string> = {
  card: 'bg-surface-2', // on a card
  page: 'bg-surface', // straight on the page background
  inset: 'bg-white/5', // on a surface-2 panel inside a card
}

/**
 * Loading placeholders: shapes in the layout's place, pulsing (still with
 * reduced motion). Always decorative; give the region aria-busy, or a
 * role="status" with words, instead.
 */
export function Skeleton({ className, tone = 'card' }: { className?: string; tone?: SkeletonTone }) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded motion-reduce:animate-none', TONE[tone], className)} />
  )
}

/** A list row: cover, two lines, an action. */
export function SkeletonRow({ cover = 'size-12', action = true }: { cover?: string; action?: boolean }) {
  return (
    <Card padding="sm" shadow={false} className="flex items-center gap-3" aria-hidden>
      <Skeleton className={cn('rounded-cover', cover)} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      {action && <Skeleton className="size-11 rounded-full" />}
    </Card>
  )
}

/** Several rows. */
export function SkeletonList({ rows = 4, cover }: { rows?: number; cover?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} cover={cover} />
      ))}
    </div>
  )
}

/** A square cover with a title and a subtitle under it, no card (profile tiles). */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      <Skeleton tone="page" className="aspect-square w-full rounded-card" />
      <Skeleton tone="page" className="h-3.5 w-3/4" />
      <Skeleton tone="page" className="h-3 w-1/3" />
    </div>
  )
}

/** A MediaCard in outline: cover and two lines on a card (rails, grids). */
export function SkeletonMediaCard({ className }: { className?: string }) {
  return (
    <Card padding="none" shadow={false} className={cn('flex flex-col gap-3 p-3', className)} aria-hidden>
      <Skeleton className="aspect-square w-full rounded-cover" />
      <div className="flex flex-col gap-2 pb-1">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  )
}

/** The media grid used by Library, Explore results and playlists. */
export const MEDIA_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5'

export function SkeletonMediaGrid({ count = 8 }: { count?: number }) {
  return (
    <div className={MEDIA_GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonMediaCard key={i} />
      ))}
    </div>
  )
}

/** A text card: header line and a few body lines. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card shadow={false} className={cn('flex flex-col gap-3', className)} aria-hidden>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </Card>
  )
}
