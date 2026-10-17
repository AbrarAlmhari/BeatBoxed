import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Pause, Play } from 'lucide-react'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { AskBeatieSheet } from '@/components/beatie/AskBeatieSheet'
import { Artwork } from '@/components/feed/Artwork'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/lib/toast'
import { cardGlowStyle, useCoverColors } from '@/lib/coverColors'
import {
  QUESTIONS,
  getTodayCheckin,
  pickSong,
  pickTags,
  skipCheckin,
  whyThisOne,
  type CheckinAnswers,
  type CheckinPick,
} from '@/lib/mood'
import { cn } from '@/lib/cn'

type Stage =
  | { kind: 'loading' }
  | { kind: 'intro' }
  | { kind: 'question'; step: number }
  | { kind: 'picking' }
  | { kind: 'result'; pick: CheckinPick }
  | { kind: 'none' }
  | { kind: 'bar'; pick: CheckinPick | null }
  | { kind: 'hidden' }
  | { kind: 'declined' }

/**
 * The daily check-in on Home (#9): an intro, four questions one at a time,
 * then one song. Once a day, by the person's own clock. After today's
 * check-in a small "Today: <song>" bar reopens the result; "Not today"
 * hides it until tomorrow.
 *
 * The pick is the database's (pick_checkin_song); the tags and the "Why
 * this one" line are fixed templates filled from what it returns.
 */
export function CheckinCard() {
  const { user } = useAuth()
  const toast = useToast()
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [answers, setAnswers] = useState<Partial<CheckinAnswers>>({})
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!user) return
    let live = true
    getTodayCheckin(user.id)
      .then(async (today) => {
        if (!live) return
        if (!today) return setStage({ kind: 'intro' })
        if (today.status === 'skipped') return setStage({ kind: 'hidden' })
        if (today.answers) setAnswers(today.answers)
        // The bar names today's song; reopening it shows the full result.
        setStage({ kind: 'bar', pick: null })
        if (today.answers && today.shown.length > 0) {
          const pick = await lastPick(today.answers, today.shown[today.shown.length - 1]).catch(() => null)
          if (live) setStage({ kind: 'bar', pick })
        }
      })
      .catch((err) => {
        console.warn('[beatboxed] check-in lookup failed:', err)
        if (live) setStage({ kind: 'hidden' })
      })
    return () => {
      live = false
    }
  }, [user])

  async function finish(full: CheckinAnswers, another = false) {
    setStage({ kind: 'picking' })
    try {
      const pick = await pickSong(full, another)
      setStage(pick ? { kind: 'result', pick } : { kind: 'none' })
    } catch (err) {
      console.error('[beatboxed] check-in pick failed:', err)
      toast.show({ message: "Couldn't find a song just now. Try again." })
      setStage({ kind: 'question', step: QUESTIONS.length - 1 })
    }
  }

  async function notToday(message = "No problem. I'll ask again tomorrow.") {
    try {
      await skipCheckin()
    } catch (err) {
      console.warn('[beatboxed] skip failed:', err)
    }
    setStage({ kind: 'declined' })
    toast.show({ beatie: true, message })
  }

  if (stage.kind === 'loading' || stage.kind === 'hidden') return null
  if (stage.kind === 'declined') return null

  if (stage.kind === 'bar') {
    return (
      <button
        type="button"
        onClick={() => stage.pick && setStage({ kind: 'result', pick: stage.pick })}
        disabled={!stage.pick}
        className="flex min-h-14 w-full items-center gap-3 rounded-chip border border-success/30 bg-surface px-3 py-2 text-left transition-colors duration-200 ease-soft hover:border-success/50"
      >
        <BeatieImage mood="happy" size={40} />
        <span className="min-w-0 flex-1 truncate text-body">
          Today:{' '}
          <span dir="auto" className="font-semibold text-success">
            {stage.pick?.title ?? '…'}
          </span>
          {stage.pick && <span className="text-muted-foreground"> · {stage.pick.artistName}</span>}
        </span>
        <span className="shrink-0 px-2 text-button text-accent">Open</span>
      </button>
    )
  }

  return (
    <section
      aria-label="Your daily check-in"
      className="relative overflow-hidden rounded-card border border-primary/40 bg-surface p-5"
    >
      {stage.kind === 'intro' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <BeatieImage mood="happy" size={64} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-meta font-semibold uppercase tracking-wide text-accent">Your song for today</p>
              <h2 className="text-section-title">4 quick taps and I'll find your song for today</h2>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStage({ kind: 'question', step: 0 })}
              className="min-h-12 flex-1 rounded-chip bg-primary text-button text-white transition-colors duration-200 ease-soft hover:bg-accent"
            >
              Let's go
            </button>
            <button
              type="button"
              onClick={() => void notToday()}
              className="min-h-12 flex-1 rounded-chip bg-surface-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
            >
              Not today
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'question' && (
        <Question
          step={stage.step}
          answers={answers}
          onBack={() =>
            setStage(stage.step === 0 ? { kind: 'intro' } : { kind: 'question', step: stage.step - 1 })
          }
          onSkip={() => void notToday("Skipped for today. I'll ask again tomorrow.")}
          onAnswer={(value) => {
            const key = QUESTIONS[stage.step].key
            const next = { ...answers, [key]: value } as Partial<CheckinAnswers>
            setAnswers(next)
            if (stage.step + 1 < QUESTIONS.length) setStage({ kind: 'question', step: stage.step + 1 })
            else void finish(next as CheckinAnswers)
          }}
        />
      )}

      {stage.kind === 'picking' && (
        <div role="status" className="flex items-center gap-4 py-6">
          <BeatieImage mood="thinking" size={56} />
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Finding your song…
          </p>
        </div>
      )}

      {stage.kind === 'none' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <BeatieImage mood="sad" size={56} />
            <div className="flex flex-col gap-1">
              <p className="text-meta font-semibold uppercase tracking-wide text-accent">Your song for today</p>
              <h2 className="text-card-title">I couldn't find a good match today.</h2>
              <p className="text-secondary text-muted-foreground">
                Try different answers, or come back tomorrow when I know more songs.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStage({ kind: 'question', step: 0 })}
            className="min-h-12 rounded-chip bg-surface-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
          >
            Start over
          </button>
        </div>
      )}

      {stage.kind === 'result' && (
        <Result
          pick={stage.pick}
          answers={answers as CheckinAnswers}
          onAnother={() => void finish(answers as CheckinAnswers, true)}
          onStartOver={() => {
            setAnswers({})
            setStage({ kind: 'question', step: 0 })
          }}
          onAsk={() => setAsking(true)}
        />
      )}

      {stage.kind === 'result' && (
        <AskBeatieSheet
          open={asking}
          onClose={() => setAsking(false)}
          initialSong={{
            id: stage.pick.songId,
            title: stage.pick.title,
            artistName: stage.pick.artistName,
            coverUrl: stage.pick.coverUrl,
            ratingAvg: null,
            reviewCount: 0,
            artistId: stage.pick.artistId,
          }}
        />
      )}
    </section>
  )
}

/** The bar knows today's last song id; this fetches it as a full pick. */
async function lastPick(_answers: CheckinAnswers, songId: string): Promise<CheckinPick | null> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return null
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist_id, artists(name), albums(cover_url), song_vibes(lyrics_mood, energy)')
    .eq('id', songId)
    .maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    id: string
    title: string
    artist_id: string | null
    artists: { name: string } | { name: string }[] | null
    albums: { cover_url: string | null } | { cover_url: string | null }[] | null
    song_vibes: { lyrics_mood: CheckinPick['lyricsMood']; energy: CheckinPick['energy'] } | { lyrics_mood: CheckinPick['lyricsMood']; energy: CheckinPick['energy'] }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  const vibe = one(row.song_vibes)
  return {
    songId: row.id,
    title: row.title,
    artistId: row.artist_id,
    artistName: one(row.artists)?.name ?? 'Unknown artist',
    coverUrl: one(row.albums)?.cover_url ?? null,
    lyricsMood: vibe?.lyrics_mood ?? 'none',
    energy: vibe?.energy ?? 'mid',
    relaxed: 0,
    followed: false,
    likedArtist: false,
    genreMatch: false,
    newToYou: false,
    similarAvg: null,
    similarCount: 0,
  }
}

function Question({
  step,
  answers,
  onBack,
  onSkip,
  onAnswer,
}: {
  step: number
  answers: Partial<CheckinAnswers>
  onBack: () => void
  onSkip: () => void
  onAnswer: (value: string) => void
}) {
  const q = QUESTIONS[step]
  const chosen = answers[q.key as keyof CheckinAnswers]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          <ArrowLeft className="size-5" strokeWidth={2} />
        </button>
        <p className="flex-1 text-meta font-semibold text-muted-foreground">
          Question {step + 1} of {QUESTIONS.length}
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="min-h-11 rounded-button px-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Skip for today
        </button>
      </div>
      <div
        role="progressbar"
        aria-label="Check-in progress"
        aria-valuemin={0}
        aria-valuemax={QUESTIONS.length}
        aria-valuenow={step + 1}
        className="flex gap-1.5"
      >
        {QUESTIONS.map((_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-white/10')} />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <BeatieImage mood="default" size={44} />
        <h2 className="text-section-title">{q.title}</h2>
      </div>
      <div role="group" aria-label={q.title} className={cn('grid gap-2', q.options.length > 3 ? 'grid-cols-2' : 'grid-cols-1')}>
        {q.options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onAnswer(o.value)}
            aria-pressed={chosen === o.value}
            className={cn(
              'min-h-12 rounded-chip border px-4 text-button transition-colors duration-200 ease-soft',
              chosen === o.value
                ? 'border-primary bg-primary/20 text-foreground'
                : 'border-line-strong bg-surface-2 text-foreground hover:border-primary/50'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Result({
  pick,
  answers,
  onAnother,
  onStartOver,
  onAsk,
}: {
  pick: CheckinPick
  answers: CheckinAnswers
  onAnother: () => void
  onStartOver: () => void
  onAsk: () => void
}) {
  const player = usePlayer()
  const colors = useCoverColors(pick.coverUrl)
  const isCurrent = player.current?.id === pick.songId
  const playing = isCurrent && player.isPlaying
  const track = {
    id: pick.songId,
    title: pick.title,
    artistName: pick.artistName,
    coverUrl: pick.coverUrl,
    ratingAvg: null,
    reviewCount: 0,
  }
  return (
    <div className="-m-5 flex flex-col gap-4 p-5" style={cardGlowStyle(colors)}>
      <div className="flex items-center gap-4">
        <BeatieImage mood="excited" size={56} />
        <div className="flex min-w-0 flex-col">
          <p className="text-meta font-semibold uppercase tracking-wide text-accent">Your song for today</p>
          <h2 className="text-section-title">Here's what I found for you.</h2>
        </div>
      </div>
      <div className="flex gap-4">
        <Link to={`/song/${pick.songId}`} className="w-28 shrink-0 sm:w-32" aria-hidden tabIndex={-1}>
          <Artwork src={pick.coverUrl} seed={pick.songId} className="aspect-square size-full rounded-card" />
        </Link>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link to={`/song/${pick.songId}`} dir="auto" className="text-section-title transition-colors duration-200 ease-soft hover:text-accent">
            {pick.title}
          </Link>
          {pick.artistId ? (
            <Link to={`/artist/${pick.artistId}`} className="w-fit text-body text-muted-foreground hover:text-foreground">
              {pick.artistName}
            </Link>
          ) : (
            <p className="text-body text-muted-foreground">{pick.artistName}</p>
          )}
          <ul className="flex flex-wrap gap-1.5" aria-label="About this song">
            {pickTags(pick).map((t) => (
              <li key={t} className="rounded-chip bg-white/10 px-2.5 py-1 text-meta font-semibold text-foreground">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="rounded-card bg-primary/15 px-4 py-3 text-body text-foreground">
        <span className="font-semibold text-accent">Why this one: </span>
        {whyThisOne(pick, answers)}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (isCurrent ? player.toggle() : player.playQueue([track], 0))}
          aria-label={playing ? `Pause ${pick.title}` : `Play ${pick.title}`}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors duration-200 ease-soft hover:bg-accent"
        >
          {isCurrent && player.loading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-5 fill-current" strokeWidth={0} />
          ) : (
            <Play className="ml-0.5 size-5 fill-current" strokeWidth={0} />
          )}
        </button>
        <button
          type="button"
          onClick={onAsk}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-chip bg-surface-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
        >
          <BeatieImage mood="mark" size={28} />
          Ask me about it
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onAnother}
          className="min-h-11 text-button text-accent transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Not feeling it? Show another
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="min-h-11 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
