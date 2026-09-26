import { tintFor } from './tint'

export function GenreTile({
  genre,
  onClick,
}: {
  genre: string
  onClick: () => void
}) {
  const t = tintFor(genre)
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex aspect-[16/9] items-end overflow-hidden rounded-card p-3 text-left shadow-card transition-all duration-250 ease-soft hover:-translate-y-1 active:translate-y-0 active:scale-[0.98]"
      style={{
        background: `linear-gradient(135deg,
          color-mix(in oklab, var(--color-primary) ${22 + t * 50}%, var(--color-surface)),
          color-mix(in oklab, var(--color-accent) ${12 + t * 38}%, var(--color-background)))`,
      }}
    >
      <span className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-250 group-hover:opacity-100" />
      <span className="relative text-card-title capitalize">{genre}</span>
    </button>
  )
}
