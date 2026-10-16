import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'

/** Shared chrome for the three full-list pages. */
export function ListPageShell({
  title,
  hideTitle = false,
  toolbar,
  loading,
  isEmpty,
  emptyTitle,
  emptyDetail,
  hasMore,
  loadingMore,
  onLoadMore,
  children,
}: {
  title: string
  /** Inside a sheet or dialog that already shows the title. */
  hideTitle?: boolean
  toolbar?: ReactNode
  loading: boolean
  isEmpty: boolean
  emptyTitle: string
  emptyDetail: string
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-6 pt-2">
      {!hideTitle && (
        <h1 dir="auto" className="text-page-title">
          {title}
        </h1>
      )}

      {toolbar}

      {loading ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <SkeletonList rows={4} cover="size-11 rounded-full" />
        </div>
      ) : isEmpty ? (
        <EmptyState face="sleepy-sticker" title={emptyTitle} detail={emptyDetail} />
      ) : (
        <>
          {children}
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="flex min-h-11 items-center justify-center gap-2 rounded-button border border-line bg-surface px-4 py-3 text-button text-muted-foreground shadow-card transition-all duration-200 ease-soft hover:bg-surface-2 hover:text-foreground active:scale-[0.99] disabled:opacity-60"
            >
              {loadingMore && (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              )}
              Load more
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Filters a loaded list client-side; no new search backend. */
export function FilterBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25"
    />
  )
}
