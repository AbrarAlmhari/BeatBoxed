import { Sparkles } from 'lucide-react'
import { BeatieChat } from './BeatieChat'

/** Beatie's card on the Song page: the label, then the shared chat. */
export function BeatieCard({ songId }: { songId: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-full bg-primary/15">
          <Sparkles className="size-4 text-accent" strokeWidth={2} aria-hidden />
        </span>
        <div className="flex flex-col">
          <span className="text-card-title">Beatie</span>
          <span className="text-meta text-muted-foreground">Your music buddy</span>
        </div>
      </div>
      <BeatieChat songId={songId} />
    </div>
  )
}
