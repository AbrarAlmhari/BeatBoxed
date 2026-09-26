import { useState } from 'react'
import { Play, Star } from 'lucide-react'

export type MediaCardProps = {
  title: string
  subtitle: string
  /** 0–1, positions the placeholder artwork along the primary→accent gradient. */
  tint: number
  /** Real artwork when available; falls back to the gradient when null or broken. */
  coverUrl?: string | null
  ratingAvg?: number | null
  reviewCount?: number
}

export function MediaCard({
  title,
  subtitle,
  tint,
  coverUrl,
  ratingAvg,
  reviewCount,
}: MediaCardProps) {
  const [coverFailed, setCoverFailed] = useState(false)
  const showCover = Boolean(coverUrl) && !coverFailed

  return (
    <button
      type="button"
      className="group flex w-full flex-col gap-3 rounded-card bg-surface p-3 text-left shadow-card transition-all duration-250 ease-soft hover:-translate-y-1 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px]">
        {showCover ? (
          <img
            src={coverUrl!}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-soft group-hover:scale-105"
          />
        ) : (
          <div
            className="absolute inset-0 transition-transform duration-500 ease-soft group-hover:scale-105"
            style={{
              background: `linear-gradient(135deg,
                color-mix(in oklab, var(--color-primary) ${18 + tint * 55}%, var(--color-surface-2)),
                color-mix(in oklab, var(--color-accent) ${10 + tint * 40}%, var(--color-background)))`,
            }}
          />
        )}

        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity duration-250 group-hover:opacity-100" />
        <span className="absolute bottom-2.5 right-2.5 grid size-10 translate-y-2 place-items-center rounded-full bg-primary opacity-0 shadow-lg transition-all duration-250 ease-soft group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          <Play className="size-[18px] translate-x-[1px] fill-white text-white" />
        </span>
      </div>

      <div className="min-w-0 pb-1">
        <p className="truncate text-card-title">{title}</p>
        <p className="mt-0.5 truncate text-secondary text-muted-foreground">
          {subtitle}
        </p>

        {ratingAvg != null && (
          <p className="mt-1.5 flex items-center gap-1 text-meta text-muted-foreground">
            <Star className="size-3.5 shrink-0 fill-star text-star" />
            <span className="text-foreground">{ratingAvg.toFixed(1)}</span>
            {reviewCount != null && <span>({reviewCount})</span>}
          </p>
        )}
      </div>
    </button>
  )
}
