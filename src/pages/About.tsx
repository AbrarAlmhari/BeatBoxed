import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Star, Users, type LucideIcon } from 'lucide-react'
import { ABOUT, type AboutIcon, type TeamMember } from '@/content/about'
import { useAuth } from '@/lib/auth'
import { pauseAppPlayer } from '@/lib/player'
import { cardClass } from '@/components/ui/Card'
import { PageGlow } from '@/components/ui/PageGlow'
import { cn } from '@/lib/cn'

/**
 * About BeatBoxed: public, outside the app shell, so it opens signed out and
 * from a shared link. All of its text comes from content/about.ts.
 */

const ICONS: Record<AboutIcon, LucideIcon> = { star: Star, people: Users, chat: MessageCircle }

/**
 * Record grooves, as on the song of the week, under two light streaks: plain
 * rings look the same at every angle, so the streaks are what shows the spin.
 */
const GROOVES: CSSProperties = {
  background: [
    'conic-gradient(from 20deg, transparent 0 25deg, rgb(255 255 255 / 0.22) 45deg, transparent 65deg 205deg, rgb(255 255 255 / 0.14) 225deg, transparent 245deg)',
    'repeating-radial-gradient(circle at center, #121216 0 2px, #22222A 2px 4px)',
  ].join(', '),
}

/** Sets the tab title and description while the page is open. */
function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const before = { title: document.title, description: tag?.content }
    document.title = title
    if (tag) tag.content = description
    return () => {
      document.title = before.title
      if (tag && before.description !== undefined) tag.content = before.description
    }
  }, [title, description])
}

/**
 * The team's songs: one preview at a time, on its own audio element. Tapping
 * the one playing stops it; tapping another switches. It stops when the
 * preview ends or the page is left. A link that won't play changes nothing
 * on screen, since a record only counts as playing once its audio starts.
 */
function useTeamSongs() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const wanted = useRef<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    const a = new Audio()
    a.preload = 'none'
    audio.current = a
    const onPlaying = () => setPlaying(wanted.current)
    const onEnded = () => {
      wanted.current = null
      setPlaying(null)
    }
    const onError = () => {
      onEnded()
      a.pause()
    }
    a.addEventListener('playing', onPlaying)
    a.addEventListener('ended', onEnded)
    a.addEventListener('error', onError)
    return () => {
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('error', onError)
      a.pause()
      a.removeAttribute('src')
      a.load()
      audio.current = null
    }
  }, [])

  const toggle = useCallback((member: TeamMember) => {
    const a = audio.current
    if (!a || !member.song) return
    if (wanted.current === member.name) {
      wanted.current = null
      a.pause()
      setPlaying(null)
      return
    }
    // The app's own player (still going if the page was opened from the
    // app) pauses rather than playing underneath.
    pauseAppPlayer()
    wanted.current = member.name
    setPlaying(null)
    a.src = member.song.previewUrl
    a.play().catch(() => {
      if (wanted.current !== member.name) return
      wanted.current = null
      a.pause()
    })
  }, [])

  return { playing, toggle }
}

export default function About() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  usePageMeta(ABOUT.meta.title, ABOUT.meta.description)

  function goBack() {
    // Opened directly (a shared link or a refresh): nothing of ours behind it.
    if (location.key === 'default') navigate(user ? '/settings' : '/login', { replace: true })
    else navigate(-1)
  }

  const { intro, what, why, team, builtWith, footer } = ABOUT
  const songs = useTeamSongs()

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-background">
      <PageGlow strength="soft" />
      <div className="mx-auto flex w-full max-w-[1080px] flex-col px-4 pb-16 sm:px-6">
        <header className="flex items-center justify-between py-3.5">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="grid size-11 place-items-center rounded-full bg-white/[0.07] text-foreground transition-all duration-200 ease-soft hover:bg-white/10 active:scale-95"
          >
            <ArrowLeft className="size-5" strokeWidth={2} />
          </button>
          {!loading && !user && (
            <Link
              to="/signup"
              className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98]"
            >
              {ABOUT.joinLabel}
            </Link>
          )}
        </header>

        <section className="flex flex-col items-center pt-7 pb-9 text-center">
          <p className="text-meta font-semibold tracking-[0.12em] text-accent uppercase">{intro.eyebrow}</p>
          <h1 className="mt-2.5 mb-3 text-[clamp(2.125rem,7vw,3.5rem)] leading-[1.05] font-bold tracking-[-0.03em] text-foreground">
            {intro.title}
            <br />
            <span className="bg-gradient-to-r from-accent to-like bg-clip-text text-transparent">
              {intro.highlight}
            </span>
          </h1>
          <p className="max-w-[620px] text-[1.0625rem] leading-relaxed text-muted-foreground">{intro.body}</p>
        </section>

        <Section title={what.title} body={what.body}>
          <div className="grid gap-3.5 sm:grid-cols-3">
            {what.cards.map((c) => {
              const Icon = ICONS[c.icon]
              return (
                <div key={c.title} className={cardClass({ padding: 'none' })}>
                  <div className="flex flex-col p-5">
                    <span className="mb-3 grid size-11 place-items-center rounded-[14px] bg-primary/15 text-accent">
                      <Icon className="size-[22px]" strokeWidth={2} aria-hidden />
                    </span>
                    <h3 className="mb-1.5 text-card-title text-foreground">{c.title}</h3>
                    <p className="text-secondary text-muted-foreground">{c.body}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title={why.title}>
          <div className={cn(cardClass({ padding: 'none' }), 'flex flex-col gap-2.5 p-5 sm:p-6')}>
            {why.paragraphs.map((p) => (
              <p key={p} className="text-body text-foreground/85">
                {p}
              </p>
            ))}
          </div>
        </Section>

        <Section title={team.title} body={team.body}>
          <ul aria-label="Team" className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {team.members.map((m) => (
              <MemberCard
                key={m.name}
                member={m}
                badge={team.leadBadge}
                altFor={team.photoAlt}
                playing={songs.playing === m.name}
                onPlay={() => songs.toggle(m)}
              />
            ))}
          </ul>
        </Section>

        <Section title={builtWith.title}>
          <ul aria-label="Built with" className="flex flex-wrap gap-2">
            {builtWith.tools.map((t) => (
              <li key={t} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-secondary text-foreground/90">
                {t}
              </li>
            ))}
          </ul>
        </Section>

        <footer className="mt-12 flex flex-wrap justify-between gap-x-5 gap-y-2 border-t border-line pt-5 text-secondary text-muted-foreground">
          <span>{footer.credit}</span>
          <span>{footer.signoff}</span>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <section className="mt-11 flex flex-col">
      <h2 className="mb-1.5 text-section-title text-foreground">{title}</h2>
      {body && <p className="mb-5 max-w-[700px] text-body text-muted-foreground">{body}</p>}
      {!body && <div className="mb-3.5" />}
      {children}
    </section>
  )
}

/**
 * The grooves spin on hover, and keep spinning while the member's song
 * plays; the picture in the middle stays still. With reduced motion nothing
 * spins, and a small bars badge says the song is playing instead.
 */
function Record({
  member,
  alt,
  playing,
  onPlay,
}: {
  member: TeamMember
  alt: string
  playing: boolean
  onPlay: () => void
}) {
  const [failed, setFailed] = useState(false)
  const face = (
    <>
      <span
        aria-hidden
        style={GROOVES}
        className={cn(
          'absolute inset-0 rounded-full shadow-[0_0_0_2px_rgb(255_255_255/0.08)] motion-safe:group-hover:animate-record-spin',
          playing && 'motion-safe:animate-record-spin'
        )}
      />
      <span
        className="relative grid size-[53px] place-items-center overflow-hidden rounded-full"
        style={{ background: member.color, boxShadow: `0 0 0 2px ${member.color}` }}
      >
        {failed ? (
          <span role="img" aria-label={alt} className="text-[0.85rem] font-bold tracking-[0.02em] text-white">
            {member.initials}
          </span>
        ) : (
          <img
            src={member.photo}
            alt={alt}
            width={53}
            height={53}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        )}
      </span>
      {playing && (
        <span
          data-playing-badge
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 hidden h-6 items-end gap-[2px] rounded-full bg-primary px-1.5 pb-1.5 pt-1.5 ring-2 ring-surface motion-reduce:flex"
        >
          <span className="h-2 w-[3px] rounded-full bg-white" />
          <span className="h-3 w-[3px] rounded-full bg-white" />
          <span className="h-1.5 w-[3px] rounded-full bg-white" />
        </span>
      )}
    </>
  )

  if (!member.song) {
    return <span className="relative grid size-[88px] shrink-0 place-items-center">{face}</span>
  }
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={playing ? 'Stop' : `Play ${member.name}'s song`}
      data-record-button
      className="relative grid size-[88px] shrink-0 cursor-pointer place-items-center rounded-full"
    >
      {face}
    </button>
  )
}

function MemberCard({
  member,
  badge,
  altFor,
  playing,
  onPlay,
}: {
  member: TeamMember
  badge: string
  altFor: (name: string) => string
  playing: boolean
  onPlay: () => void
}) {
  return (
    <li
      data-team-card
      className={cn(
        'group flex flex-col gap-3 rounded-card border p-[18px] shadow-card',
        member.lead
          ? 'border-primary/55 bg-gradient-to-b from-primary/10 to-surface to-60% md:col-span-2 lg:col-span-3'
          : 'border-line bg-surface'
      )}
    >
      <div className="flex items-center gap-3.5">
        <Record member={member} alt={altFor(member.name)} playing={playing} onPlay={onPlay} />
        <div className="flex min-w-0 flex-col">
          <h3 className="text-card-title text-foreground">
            {member.name}
            {member.lead && (
              <span className="ml-1.5 inline-block rounded-full bg-primary px-2 py-px align-[2px] text-[0.6875rem] font-bold text-white">
                {badge}
              </span>
            )}
          </h3>
          <span className="text-meta font-semibold text-accent">{member.role}</span>
        </div>
      </div>
      <p className="text-secondary text-foreground/85">{member.bio}</p>
      <ul aria-label={`${member.name}'s skills`} className="flex flex-wrap gap-1.5">
        {member.skills.map((s) => (
          <li key={s} className="rounded-full border border-line bg-white/[0.06] px-2.5 py-1 text-meta text-foreground/90">
            {s}
          </li>
        ))}
      </ul>
    </li>
  )
}
