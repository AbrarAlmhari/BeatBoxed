import type { ArtistCardModel } from '@/lib/types'
import { FollowButton } from '@/components/ui/FollowButton'
import { tintFor } from './tint'

export function ArtistResultCard({
  artist,
  following = false,
  onFollowChange,
}: {
  artist: ArtistCardModel
  following?: boolean
  onFollowChange?: (following: boolean) => void
}) {
  const t = tintFor(artist.id)
  return (
    <div className="flex w-full items-center gap-4 rounded-card bg-surface p-3 text-left shadow-card transition-colors duration-250 ease-soft hover:bg-surface-2">
      <span className="size-14 shrink-0 overflow-hidden rounded-full">
        {artist.imageUrl ? (
          <img
            src={artist.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span
            className="block size-full"
            style={{
              background: `linear-gradient(135deg,
                color-mix(in oklab, var(--color-primary) ${20 + t * 55}%, var(--color-surface-2)),
                color-mix(in oklab, var(--color-accent) ${12 + t * 40}%, var(--color-background)))`,
            }}
          />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-card-title">{artist.name}</span>
        <span className="flex flex-wrap gap-1.5">
          {artist.genres.map((g) => (
            <span
              key={g}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-meta capitalize text-muted-foreground"
            >
              {g}
            </span>
          ))}
        </span>
      </span>

      <FollowButton
        artistId={artist.id}
        following={following}
        onChange={onFollowChange}
        size="sm"
      />
    </div>
  )
}
