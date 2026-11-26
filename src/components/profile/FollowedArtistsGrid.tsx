import { Link } from 'react-router-dom'
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
    <div className="flex flex-col divide-y divide-line md:grid md:grid-cols-3 md:gap-4 md:divide-y-0 lg:grid-cols-4">
      {artists.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-3 py-2.5 md:flex-col md:rounded-card md:border md:border-line md:bg-surface md:p-4 md:text-center md:shadow-card"
        >
          {a.imageUrl ? (
            <img
              src={a.imageUrl}
              alt=""
              loading="lazy"
              className="size-14 shrink-0 rounded-full object-cover md:size-20"
            />
          ) : (
            <span
              className="size-14 shrink-0 rounded-full md:size-20"
              style={{
                background: `linear-gradient(135deg,
                  color-mix(in oklab, var(--color-primary) ${20 + tintFor(a.id) * 50}%, var(--color-surface-2)),
                  color-mix(in oklab, var(--color-accent) ${12 + tintFor(a.id) * 38}%, var(--color-background)))`,
              }}
            />
          )}

          <Link
            to={`/artist/${a.id}`}
            dir="auto"
            className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold transition-colors md:flex-none md:text-card-title duration-200 ease-soft hover:text-accent"
          >
            {a.name}
          </Link>

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
