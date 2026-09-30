import { StarRating } from '@/components/ui/StarRating'
import type { ReviewWithAuthor } from '@/lib/types'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function ReviewCard({ review }: { review: ReviewWithAuthor }) {
  const name =
    review.author?.displayName || review.author?.username || 'Someone'
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <article className="flex gap-3 rounded-card bg-surface p-4 shadow-card">
      {review.author?.avatarUrl ? (
        <img
          src={review.author.avatarUrl}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
          {initial}
        </span>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-card-title">{name}</span>
          <StarRating value={review.rating} size={14} />
          <span className="text-meta text-muted-foreground">
            {dateFmt.format(new Date(review.createdAt))}
            {review.edited && ' · edited'}
          </span>
        </div>

        {review.body && (
          <p dir="auto" className="text-body text-muted-foreground">
            {review.body}
          </p>
        )}
      </div>
    </article>
  )
}
