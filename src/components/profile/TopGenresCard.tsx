import { useEffect, useId, useState } from 'react'
import { Info } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { cn } from '@/lib/cn'
import type { StatsGenre } from '@/lib/stats'

/**
 * Top genres on the Stats tab: one row per genre with a horizontal bar, the
 * song count in bold and the average rating muted. The top genre is full
 * accent, the rest softer; "Other" always comes last. Tapping a row shows
 * that genre's three most rated artists (aria-expanded). Rows are 44px+.
 *
 * Counts only songs rated 3★ or higher (the database decides that).
 */
export function TopGenresCard({ genres, className }: { genres: StatsGenre[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const [grown, setGrown] = useState(false)
  const baseId = useId()
  const max = Math.max(1, ...genres.map((g) => g.count))
  const topGenre = genres.find((g) => g.genre !== 'Other')?.genre

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <Card className={className}>
      <SectionHeader
        level={3}
        title="Top genres"
        subtitle="Songs you rated 3★ or higher · tap a genre"
        className="mb-3"
      />
      {genres.length === 0 ? (
        <p className="py-6 text-center text-secondary text-muted-foreground">
          No genres yet for the artists rated here.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {genres.map((g) => {
            const expanded = open === g.genre
            const detailId = `${baseId}-${g.genre}`
            const isTop = g.genre === topGenre
            return (
              <li key={g.genre}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  aria-label={`${g.label}: ${g.count} ${g.count === 1 ? 'song' : 'songs'}, average ${g.average.toFixed(1)} stars. Show artists.`}
                  onClick={() => setOpen(expanded ? null : g.genre)}
                  className="-mx-1.5 grid min-h-11 w-[calc(100%+0.75rem)] grid-cols-[6.5rem_1fr_auto] items-center gap-2.5 rounded-inset px-1.5 text-left transition-colors duration-200 ease-soft hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="truncate text-secondary font-semibold text-foreground/85">{g.label}</span>
                  <span className="block h-3 overflow-hidden rounded-r bg-white/[0.04]" aria-hidden>
                    <span
                      className={cn(
                        'block h-full rounded-r transition-[width] duration-700 ease-soft motion-reduce:transition-none',
                        isTop ? 'bg-primary' : 'bg-primary/45'
                      )}
                      style={{ width: grown ? `${(g.count / max) * 100}%` : 0 }}
                    />
                  </span>
                  <span className="min-w-14 text-right text-secondary font-bold tabular-nums">
                    {g.count}
                    <span className="ms-1.5 text-meta font-medium text-muted-foreground">{g.average.toFixed(1)}★</span>
                  </span>
                </button>
                <div id={detailId} hidden={!expanded} className="flex flex-wrap gap-1.5 pb-2.5 pl-[7.1rem] pt-0.5">
                  {g.artists.map((a) => (
                    <Chip key={a}>{a}</Chip>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-2.5 flex items-center gap-1.5 text-meta text-muted-foreground/80">
        <Info className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        Genres come from each artist's Wikidata page.
      </p>
    </Card>
  )
}
