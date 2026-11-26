import { forwardRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ChevronUp } from 'lucide-react'
import { Artwork } from '@/components/feed/Artwork'
import { cn } from '@/lib/cn'
import type { WeeklySong } from '@/lib/mood'
import type { WeekTimer } from '@/lib/weekTimer'

/**
 * Home's song of the week (#10): the cover as a tilted sleeve with a record
 * sliding out of it, full at the top of Home, folding into a small record
 * in the tab row (SongOfTheWeekMini). The record's centre is the week's
 * timer. State (which week, folded or not, the time) lives in
 * useSongOfTheWeek; these only draw it.
 */

/** Record grooves, drawn with CSS only. */
const GROOVES: CSSProperties = {
  background: 'repeating-radial-gradient(circle at center, #121216 0 2px, #22222A 2px 4px)',
}

/**
 * The record's centre: a pie that shrinks as the week runs out, green when
 * full through yellow and orange to red, never quite gone.
 */
function TimerLabel({ timer, size }: { timer: WeekTimer; size: number }) {
  const circumference = 2 * Math.PI * 5
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 20 20" data-week-timer data-share={timer.shareLeft.toFixed(3)}>
      <circle cx="10" cy="10" r="10" fill="#0D0D12" />
      <circle
        cx="10"
        cy="10"
        r="5"
        fill="none"
        stroke={timer.color}
        strokeWidth="10"
        strokeDasharray={`${(timer.drawnShare * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
        transform="rotate(-90 10 10)"
        data-timer-pie
      />
      <circle cx="10" cy="10" r="9.5" fill="none" stroke="rgb(201 128 90 / 0.9)" strokeWidth="1" />
    </svg>
  )
}

/** Still all week; one turn every 2.4s on the last day, none with reduced motion. */
function Record({
  timer,
  labelSize,
  className,
}: {
  timer: WeekTimer
  labelSize: number
  className?: string
}) {
  return (
    <span
      style={GROOVES}
      data-spinning={timer.lastDay ? 'true' : 'false'}
      className={cn(
        'grid place-items-center rounded-full',
        timer.lastDay && 'motion-safe:animate-[spin_2.4s_linear_infinite]',
        className
      )}
    >
      <TimerLabel timer={timer} size={labelSize} />
    </span>
  )
}

export const SongOfTheWeekFull = forwardRef<
  HTMLSpanElement,
  { week: WeeklySong; timer: WeekTimer; onFold: () => void }
>(function SongOfTheWeekFull({ week, timer, onFold }, recordRef) {
  const s = week.song
  return (
    <section
      aria-label="Song of the week"
      className="card-featured relative flex h-24 items-center gap-3 overflow-hidden pl-3 pr-2 shadow-glow-lg"
    >
      {/* The sleeve, with the record peeking out to its right. */}
      <Link to="/week" tabIndex={-1} aria-hidden className="relative h-[72px] w-[92px] shrink-0">
        <span
          ref={recordRef}
          className="absolute left-[24px] top-[3px] size-[66px] rounded-full shadow-[0_8px_18px_-8px_rgb(0_0_0/0.9)] motion-safe:animate-[record-out_700ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
        >
          <Record timer={timer} labelSize={24} className="size-full" />
        </span>
        <span className="absolute left-0 top-0 size-[72px] overflow-hidden rounded-[10px] shadow-[6px_8px_18px_-8px_rgb(0_0_0/0.9)]">
          <Artwork src={s.coverUrl} seed={s.id} className="size-full" />
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[10px] font-extrabold uppercase tracking-[0.1em] text-week">Song of the week</span>
        <Link
          to="/week"
          dir="auto"
          className="truncate font-heading text-[15px] font-bold leading-tight transition-colors duration-200 ease-soft hover:text-accent"
        >
          {s.title}
        </Link>
        <span dir="auto" className="truncate text-[12px] text-muted-foreground">
          {s.artistName}
        </span>
      </div>

      {/* The rating and, under it, the time left this week. */}
      <div className="flex shrink-0 flex-col items-center gap-1">
      <Link
        to="/week"
        className="btn-primary min-h-0! h-[34px] shrink-0 rounded-full! px-3.5 text-[13px]"
      >
        {week.myRating ? `You rated it ${week.myRating}★` : 'Rate'}
      </Link>
        <span data-week-left className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {timer.label}
        </span>
      </div>

      <button
        type="button"
        onClick={onFold}
        aria-label="Fold song of the week into the top bar"
        className="grid h-11 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground"
      >
        <ChevronUp className="size-5" strokeWidth={2} aria-hidden />
      </button>
    </section>
  )
})

/** The folded song of the week: a small record in the tab row. */
export const SongOfTheWeekMini = forwardRef<
  HTMLButtonElement,
  { timer: WeekTimer; onOpen: () => void }
>(function SongOfTheWeekMini({ timer, onOpen }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`Song of the week, ${timer.label}`}
      className="grid size-11 shrink-0 place-items-center rounded-full transition-transform duration-200 ease-soft active:scale-95"
    >
      <Record timer={timer} labelSize={18} className="size-10 shadow-[0_0_0_1.5px_rgb(255_255_255/0.12)]" />
    </button>
  )
})
