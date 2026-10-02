import { FollowButton } from '@/components/ui/FollowButton'
import { tintFor } from '@/components/explore/tint'
import type { ArtistCardModel } from '@/lib/types'

/**
 * Shared by Profile's Artists tab and the Library page, so the two can't
 * drift. Names aren't links — there's still no artist page.
 */
export function FollowedArtistsGrid({
  artists,
  showUnfollow,
  onUnfollowed,
}: {
  artists: ArtistCardModel[]
  /** Your own list, so unfollowing should drop the row from it. */
  showUnfollow: boolean
  onUnfollowed?: (artistId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {artists.map((a) => (
        <div
          key={a.id}
          className="flex flex-col items-center gap-3 rounded-card bg-surface p-4 text-center shadow-card"
        >
          {a.imageUrl ? (
            <img
              src={a.imageUrl}
              alt=""
              loading="lazy"
              className="size-20 rounded-full object-cover"
            />
          ) : (
            <span
              className="size-20 rounded-full"
              style={{
                background: `linear-gradient(135deg,
                  color-mix(in oklab, var(--color-primary) ${20 + tintFor(a.id) * 50}%, var(--color-surface-2)),
                  color-mix(in oklab, var(--color-accent) ${12 + tintFor(a.id) * 38}%, var(--color-background)))`,
              }}
            />
          )}

          <span dir="auto" className="line-clamp-2 text-card-title">
            {a.name}
          </span>

          <FollowButton
            artistId={a.id}
            size="sm"
            onChange={(next) => {
              if (!next && showUnfollow) onUnfollowed?.(a.id)
            }}
          />
        </div>
      ))}
    </div>
  )
}
