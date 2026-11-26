import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

const SEE_ALL =
  '-my-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-button px-2 text-[13px] font-semibold text-[#c4b5fd] transition-colors duration-200 ease-soft hover:text-foreground'

/**
 * A section's heading: title, an optional muted subtitle under it, and an
 * optional "See all" (a link or a button) at the end of the line. The See
 * all is a 44px target without making the row taller.
 */
export function SectionHeader({
  title,
  subtitle,
  seeAll,
  level = 2,
  id,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  seeAll?: { to: string; label?: string } | { onClick: () => void; label?: string }
  level?: 2 | 3
  /** For aria-labelledby on the section. */
  id?: string
  className?: string
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <div className={cn('flex items-baseline justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading id={id} className={level === 2 ? 'text-section-title' : 'text-card-title'}>
          {title}
        </Heading>
        {subtitle && <p className="text-secondary text-muted-foreground">{subtitle}</p>}
      </div>
      {seeAll &&
        ('to' in seeAll ? (
          <Link to={seeAll.to} className={SEE_ALL}>
            {seeAll.label ?? 'See all'}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        ) : (
          <button type="button" onClick={seeAll.onClick} className={SEE_ALL}>
            {seeAll.label ?? 'See all'}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </button>
        ))}
    </div>
  )
}
