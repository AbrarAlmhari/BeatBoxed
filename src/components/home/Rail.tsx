import type { ComponentProps, ReactNode } from 'react'
import { MediaCard } from '@/components/ui/MediaCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonMediaCard } from '@/components/ui/Skeleton'
import { usePlayer, type PlayerTrack } from '@/lib/player'

/** Card width steps up with viewport so rails never feel cramped on phones. */
const CARD_WIDTH = 'w-[44vw] max-w-[190px] sm:w-[190px] lg:w-[200px]'

function RailShell({
  title,
  action,
  children,
}: {
  title: string
  action?: ComponentProps<typeof SectionHeader>['seeAll']
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={title} seeAll={action} />
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
  songs: PlayerTrack[]
  emptyMessage: string
}) {
  const { current, isPlaying, loading, playQueue, toggle } = usePlayer()
  if (songs.length === 0) {
    return (
      <RailShell title={title}>
        <EmptyState face={null} compact title={emptyMessage} />
      </RailShell>
    )
  }

  return (
    <RailShell
      title={title}
      // There's no full list to open yet; the link is there for the layout.
      action={{ onClick: () => {} }}
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
            <SkeletonMediaCard />
          </li>
        ))}
      </ul>
    </RailShell>
  )
}
