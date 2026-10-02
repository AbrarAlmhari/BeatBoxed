import { Link } from 'react-router-dom'
import { PlaylistCover } from './PlaylistCover'
import type { PlaylistSummary } from '@/lib/playlists'

/** Same grid and card shell as Library's songs and Explore's results. */
const GRID =
  'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5'

export function PlaylistGrid({ playlists }: { playlists: PlaylistSummary[] }) {
  return (
    <div className={GRID}>
      {playlists.map((p) => (
        <Link
          key={p.id}
          to={`/playlist/${p.id}`}
          className="group flex flex-col gap-3 rounded-card bg-surface p-3 shadow-card transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
        >
          <PlaylistCover covers={p.coverUrls} seed={p.id} customUrl={p.coverUrl} />
          <div className="flex flex-col gap-0.5 pb-1">
            <p dir="auto" className="truncate text-card-title">
              {p.title}
            </p>
            <p className="text-secondary text-muted-foreground">
              {p.songCount} {p.songCount === 1 ? 'song' : 'songs'}
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function PlaylistGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card bg-surface p-3">
          <div className="aspect-square w-full animate-pulse rounded-[10px] bg-surface-2" />
          <div className="flex flex-col gap-2 pb-1">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  )
}
