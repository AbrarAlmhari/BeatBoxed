import { cn } from '@/lib/cn'
import { Card } from './Card'

/**
 * Loading placeholders: shapes in the layout's place, pulsing (still with
 * reduced motion). Always decorative; give the region aria-busy instead.
 *
 * `onCard` is for shapes drawn on a card (one step lighter than the card).
 */
export function Skeleton({ className, onCard = true }: { className?: string; onCard?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded motion-reduce:animate-none', onCard ? 'bg-surface-2' : 'bg-surface', className)}
    />
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

/** A square cover with a title and a subtitle under it (rails, grids). */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      <Skeleton onCard={false} className="aspect-square w-full rounded-card" />
      <Skeleton onCard={false} className="h-3.5 w-3/4" />
      <Skeleton onCard={false} className="h-3 w-1/3" />
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
