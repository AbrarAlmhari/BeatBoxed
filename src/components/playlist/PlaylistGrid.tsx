import { Link } from 'react-router-dom'
import { PlaylistCover } from './PlaylistCover'
import { MEDIA_GRID, SkeletonMediaGrid } from '@/components/ui/Skeleton'
import type { PlaylistSummary } from '@/lib/playlists'

/** Same grid and card shell as Library's songs and Explore's results. */
const GRID = MEDIA_GRID

export function PlaylistGrid({ playlists }: { playlists: PlaylistSummary[] }) {
  return (
    <div className={GRID}>
      {playlists.map((p) => (
        <Link
          key={p.id}
          to={`/playlist/${p.id}`}
          className="group flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
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
  return <SkeletonMediaGrid count={count} />
}
