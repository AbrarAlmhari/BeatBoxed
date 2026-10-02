import type { ReactNode } from 'react'
import { MediaCard } from '@/components/ui/MediaCard'
import { usePlayer } from '@/lib/player'
import type { SongCardModel } from '@/lib/types'

/** Card width steps up with viewport so rails never feel cramped on phones. */
const CARD_WIDTH = 'w-[44vw] max-w-[190px] sm:w-[190px] lg:w-[200px]'

function RailShell({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Rail({
  title,
  songs,
  emptyMessage,
}: {
  title: string
  songs: SongCardModel[]
  emptyMessage: string
}) {
  const { current, isPlaying, loading, playQueue, toggle } = usePlayer()
  if (songs.length === 0) {
    return (
      <RailShell title={title}>
        <div className="rounded-card bg-surface px-5 py-8 text-center">
          <p className="text-body text-muted-foreground">{emptyMessage}</p>
        </div>
      </RailShell>
    )
  }

  return (
    <RailShell
      title={title}
      action={
        <button
          type="button"
          className="shrink-0 rounded-button px-2 py-1 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-accent"
        >
          See all
        </button>
      }
    >
      {/* Negative margin lets cards bleed to the screen edge while keeping the
          section heading aligned with the page gutter. */}
      <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:gap-4 sm:px-6 lg:-mx-8 lg:px-8">
        {songs.map((song, i) => (
          <li key={song.id} className={`${CARD_WIDTH} shrink-0 snap-start`}>
            <MediaCard
              to={`/song/${song.id}`}
              // Queues the whole rail from here, so next/previous work.
              onPlay={() =>
                current?.id === song.id ? toggle() : playQueue(songs, i)
              }
              isCurrent={current?.id === song.id}
              isPlaying={current?.id === song.id && isPlaying}
              isLoading={current?.id === song.id && loading}
              title={song.title}
              subtitle={song.artistName}
              coverUrl={song.coverUrl}
              ratingAvg={song.ratingAvg}
              reviewCount={song.reviewCount}
              tint={songs.length > 1 ? i / (songs.length - 1) : 0.5}
            />
          </li>
        ))}
      </ul>
    </RailShell>
  )
}

export function RailSkeleton({ title }: { title: string }) {
  return (
    <RailShell title={title}>
      <ul
        className="no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4 pb-1 sm:-mx-6 sm:gap-4 sm:px-6 lg:-mx-8 lg:px-8"
        aria-hidden
      >
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={`${CARD_WIDTH} shrink-0`}>
            <div className="flex flex-col gap-3 rounded-card bg-surface p-3">
              <div className="aspect-square w-full animate-pulse rounded-[10px] bg-surface-2" />
              <div className="flex flex-col gap-2 pb-1">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </RailShell>
  )
}
