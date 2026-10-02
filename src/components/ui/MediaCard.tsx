import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Pause, Play, Star } from 'lucide-react'
import { cn } from '@/lib/cn'

export type MediaCardProps = {
  title: string
  subtitle: string
  /** 0–1, positions the placeholder artwork along the primary→accent gradient. */
  tint: number
  /** Real artwork when available; falls back to the gradient when null or broken. */
  coverUrl?: string | null
  ratingAvg?: number | null
  reviewCount?: number
  /** When set the card becomes a real link, so middle-click and open-in-new-tab work. */
  to?: string
  /** Press-play handler. The card itself still navigates to the song page. */
  onPlay?: () => void
  isCurrent?: boolean
  isPlaying?: boolean
  isLoading?: boolean
}

const CARD_CLASS =
  'group flex w-full flex-col gap-3 rounded-card bg-surface p-3 text-left shadow-card transition-all duration-250 ease-soft hover:-translate-y-1 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]'

export function MediaCard({
  title,
  subtitle,
  tint,
  coverUrl,
  ratingAvg,
  reviewCount,
  to,
  onPlay,
  isCurrent = false,
  isPlaying = false,
  isLoading = false,
}: MediaCardProps) {
  const [coverFailed, setCoverFailed] = useState(false)
  const showCover = Boolean(coverUrl) && !coverFailed

  const body: ReactNode = (
    <>
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

        {onPlay && (
          <span
            // 44px tap target around a 40px button, per the touch guidance.
            role="button"
            tabIndex={0}
            aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
            onClick={(e) => {
              // The card is a link; a tap here must not also navigate.
              e.preventDefault()
              e.stopPropagation()
              onPlay()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onPlay()
              }
            }}
            className={cn(
              'absolute bottom-1 right-1 grid size-11 cursor-pointer place-items-center transition-all duration-250 ease-soft',
              // Always visible once this is the playing track.
              isCurrent ? 'opacity-100' : 'play-affordance'
            )}
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary shadow-lg">
              {isLoading ? (
                <Loader2 className="size-[18px] animate-spin text-white" strokeWidth={2.5} />
              ) : isPlaying ? (
                <Pause className="size-[18px] fill-white text-white" />
              ) : (
                <Play className="size-[18px] translate-x-[1px] fill-white text-white" />
              )}
            </span>
          </span>
        )}
      </div>

      <div className="min-w-0 pb-1">
        <p dir="auto" className="truncate text-card-title">
          {title}
        </p>
        <p dir="auto" className="mt-0.5 truncate text-secondary text-muted-foreground">
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
    </>
  )

  if (to) {
    return (
      <Link to={to} className={CARD_CLASS}>
        {body}
      </Link>
    )
  }

  return (
    <button type="button" className={CARD_CLASS}>
      {body}
    </button>
  )
}
