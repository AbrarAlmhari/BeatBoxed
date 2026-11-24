import { Link } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { tintFor } from '@/components/explore/tint'
import type { ReviewWithSong } from '@/lib/types'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

/** Shared by the Profile tab preview and the full reviews page. */
export function ProfileReviewCard({ review }: { review: ReviewWithSong }) {
  const t = tintFor(review.id)

  return (
    <Link
      to={review.song ? `/song/${review.song.id}` : '#'}
      className="flex gap-3 px-4 py-3 transition-colors duration-200 ease-soft hover:bg-white/[0.03] sm:px-5"
    >
      <span className="size-11 shrink-0 overflow-hidden rounded-thumb ring-1 ring-white/10">
        {review.song?.coverUrl ? (
          <img
            src={review.song.coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span
            className="grid size-full place-items-center"
            style={{
              background: `linear-gradient(135deg,
                color-mix(in oklab, var(--color-primary) ${20 + t * 50}%, var(--color-surface-2)),
                color-mix(in oklab, var(--color-accent) ${12 + t * 38}%, var(--color-background)))`,
            }}
          >
            <Disc3 className="size-5 text-white/70" strokeWidth={1.5} />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2">
          <span dir="auto" className="text-[15px] font-semibold leading-snug">
            {review.song?.title ?? 'Unknown song'}
          </span>
          <StarRating value={review.rating} size={13} />
          <span className="text-meta text-muted-foreground">
            {dateFmt.format(new Date(review.createdAt))}
            {review.edited && ' · edited'}
          </span>
        </span>
        <span dir="auto" className="text-[13.5px] text-muted-foreground">
          {review.song?.artistName}
        </span>
        {review.title && (
          <span dir="auto" className="mt-1 block w-full text-[15px] font-semibold leading-snug">
            {review.title}
          </span>
        )}
        {review.body && (
          <span dir="auto" className="block w-full whitespace-pre-line text-[15px] leading-[1.45] text-foreground/[0.88]">
            {review.body}
          </span>
        )}
      </span>
    </Link>
  )
}
