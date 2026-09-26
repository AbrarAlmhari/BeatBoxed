import { Quote } from 'lucide-react'
import type { LyricMatch } from '@/lib/types'

export function LyricResultCard({ match }: { match: LyricMatch }) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-card bg-surface p-4 text-left shadow-card transition-all duration-250 ease-soft hover:bg-surface-2 active:scale-[0.99]"
    >
      <Quote
        className="mt-0.5 size-4 shrink-0 text-primary"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="flex min-w-0 flex-col gap-1.5">
        {/* Lyrics may be RTL; let the browser resolve direction per line. */}
        <span dir="auto" className="text-body text-foreground">
          {match.line}
        </span>
        <span dir="auto" className="truncate text-secondary text-muted-foreground">
          {match.songTitle} · {match.artistName}
        </span>
      </span>
    </button>
  )
}
