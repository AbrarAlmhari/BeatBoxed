import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/** Shared chrome for the three full-list pages. */
export function ListPageShell({
  title,
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
      <h1 dir="auto" className="text-page-title">
        {title}
      </h1>

      {toolbar}

      {loading ? (
        <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading…
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-card-title">{emptyTitle}</p>
          <p className="max-w-sm text-body text-muted-foreground">{emptyDetail}</p>
        </div>
      ) : (
        <>
          {children}
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="flex items-center justify-center gap-2 rounded-button bg-surface px-4 py-3 text-button text-muted-foreground shadow-card transition-all duration-200 ease-soft hover:bg-surface-2 hover:text-foreground active:scale-[0.99] disabled:opacity-60"
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
