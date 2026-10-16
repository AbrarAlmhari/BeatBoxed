import { cn } from '@/lib/cn'

/** Round avatar, or the first letter of the name on a soft tint. */
export function PersonAvatar({
  name,
  url,
  className,
}: {
  name: string
  url: string | null | undefined
  /** Size and any ring, e.g. "size-9". */
  className?: string
}) {
  if (url) {
    return (
      <img src={url} alt="" loading="lazy" className={cn('shrink-0 rounded-full object-cover', className)} />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary/25 font-semibold text-foreground',
        className
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Two or three small avatars overlapping, for "Liked by" and "View all". */
export function AvatarStack({
  people,
  className,
}: {
  people: { id: string; name: string; avatarUrl: string | null }[]
  className?: string
}) {
  if (people.length === 0) return null
  return (
    <span aria-hidden className={cn('flex -space-x-1.5', className)}>
      {people.map((p) => (
        <PersonAvatar
          key={p.id}
          name={p.name}
          url={p.avatarUrl}
          className="size-6 text-[11px] ring-2 ring-surface"
        />
      ))}
    </span>
  )
}
