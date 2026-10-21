import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, Disc3, Heart, Loader2, Pause, Play, Search } from 'lucide-react'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { UsernameField } from '@/components/auth/UsernameField'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { StarInput } from '@/components/ui/StarInput'
import { SetupFrame } from './SetupFrame'
import { cn } from '@/lib/cn'
import { useFollows } from '@/lib/follows'
import { usePlayer } from '@/lib/player'
import { useOnboarding } from '@/lib/onboardingContext'
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  getFollowedArtistIds,
  searchCatalog,
  setSongLike,
  updateProfile,
  uploadAvatar,
  upsertReview,
} from '@/lib/catalog'
import {
  SETUP_ALL_SET,
  completeSetup,
  markTour,
  setMusicTags,
  setupCounts,
  suggestedArtists,
  suggestedReviewers,
  suggestedSongs,
  type SuggestedArtist,
  type SuggestedReviewer,
} from '@/lib/onboarding'
import { MUSIC_TAGS, TAGS_MAX, TAGS_MIN, cleanCustomTag, sameTag, tagLabel } from '@/lib/tags'
import { FEED_MIN_BODY_CHARS } from '@/lib/feed'
import { BIO_MAX } from '@/lib/profile'
import { normalizeUsername, usernameProblem, usernameSubmittable, useUsernameStatus } from '@/lib/username'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { SongCardModel } from '@/lib/types'
import { ScrollRow } from '@/components/ui/ScrollRow'

export type SetupProfile = {
  username: string
  displayName: string
  avatarUrl: string | null
  bio: string
  tags: string[]
}

type StepProps = {
  userId: string
  profile: SetupProfile
  setProfile: (patch: Partial<SetupProfile>) => void
  next: () => void
  back: () => void
}

const fieldClass =
  'w-full rounded-card border border-line-strong bg-surface px-4 py-3 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/20 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60'

function errorText(err: unknown, fallback: string) {
  const code = (err as { code?: string } | null)?.code
  if (code === '23505') return 'That username is taken. Pick another.'
  if (code === '23514') return (err as { message?: string }).message ?? fallback
  return fallback
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-secondary text-danger">
      {children}
    </p>
  )
}

/* ---------------------------------------------------------------- step 1 */

export function StepUsername({ userId, profile, setProfile, next }: StepProps) {
  const [value, setValue] = useState(profile.username)
  const status = useUsernameStatus(value, profile.username)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = normalizeUsername(value)
  const ok = name !== '' && !usernameProblem(name) && usernameSubmittable(status) && status.state !== 'checking'

  async function save() {
    setError(null)
    if (name === normalizeUsername(profile.username)) return next()
    setPending(true)
    try {
      await updateProfile(userId, { username: name })
      setProfile({ username: name })
      next()
    } catch (err) {
      setError(errorText(err, "Couldn't save your username. Try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <SetupFrame
      step={1}
      required
      beatie={{ mood: 'happy', text: "Hi, I'm Beatie! Let's set up your profile. It takes about two minutes." }}
      title="Pick a username"
      subtitle="This is how people find and @mention you."
      primary={{ label: 'Continue', onClick: () => void save(), disabled: !ok, pending }}
    >
      <UsernameField
        value={value}
        onChange={setValue}
        status={status.state === 'unchanged' && !usernameProblem(name) ? { state: 'available' } : status}
        disabled={pending}
        rule="4 to 20 characters. Lowercase letters, numbers, _ and . only. We suggested one from your email; change it if you like."
      />
      {error && <Alert>{error}</Alert>}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 2 */

export function StepProfile({ userId, profile, setProfile, next, back }: StepProps) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio.slice(0, BIO_MAX))
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const initial = (displayName.trim() || profile.username || '?').charAt(0).toUpperCase()

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (!AVATAR_TYPES.includes(file.type)) return setError('Pick a PNG, JPEG, or WebP image.')
    if (file.size > AVATAR_MAX_BYTES) return setError('Keep the image under 2MB.')
    setUploading(true)
    try {
      setAvatarUrl(await uploadAvatar(userId, file))
    } catch {
      setError("Couldn't upload that image. Try again.")
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!displayName.trim()) return setError('Add a display name.')
    setPending(true)
    setError(null)
    try {
      await updateProfile(userId, {
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
      })
      setProfile({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl })
      next()
    } catch {
      setError("Couldn't save. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <SetupFrame
      step={2}
      onBack={back}
      title="Make it yours"
      subtitle="Your display name is required. Photo and bio are optional, and you can change all of them later."
      primary={{ label: 'Continue', onClick: () => void save(), disabled: !displayName.trim() || uploading, pending }}
    >
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a photo (optional)"
          className="relative size-28 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center rounded-full bg-gradient-to-br from-primary/60 to-primary text-[44px] font-bold text-white">
              {initial}
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 grid size-10 place-items-center rounded-full border-4 border-background bg-primary text-white">
            {uploading ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
            ) : (
              <Camera className="size-4" strokeWidth={2} />
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="min-h-11 text-button text-accent hover:text-foreground"
        >
          Add a photo (optional)
        </button>
        <input ref={fileRef} type="file" accept={AVATAR_TYPES.join(',')} onChange={pick} className="sr-only" tabIndex={-1} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-semibold">
          Display name <span className="text-glow-2">*</span>{' '}
          <span className="font-normal text-muted-foreground">(required)</span>
        </span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          required
          dir="auto"
          disabled={pending}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-semibold">
          Bio <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          rows={3}
          dir="auto"
          disabled={pending}
          className={cn(fieldClass, 'resize-none')}
        />
        <span className="self-end text-meta text-muted-foreground tabular-nums">
          {bio.length} / {BIO_MAX}
        </span>
      </label>
      {error && <Alert>{error}</Alert>}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 3 */

/** The tag picker: offered tags plus your own, filtered by the box above. */
export function TagPicker({
  selected,
  onChange,
  max = TAGS_MAX,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  max?: number
}) {
  const [query, setQuery] = useState('')
  const typed = cleanCustomTag(query)
  const offered = [...MUSIC_TAGS, ...selected.filter((s) => !MUSIC_TAGS.some((t) => sameTag(t, s)))]
  const shown = query.trim() ? offered.filter((t) => tagLabel(t).toLowerCase().includes(query.trim().toLowerCase())) : offered
  const canAddTyped = typed && !offered.some((t) => sameTag(t, typed)) && selected.length < max
  const full = selected.length >= max

  function toggle(tag: string) {
    const on = selected.some((s) => sameTag(s, tag))
    if (on) onChange(selected.filter((s) => !sameTag(s, tag)))
    else if (!full) onChange([...selected, tagLabel(tag)])
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAddTyped) {
              e.preventDefault()
              onChange([...selected, typed])
              setQuery('')
            }
          }}
          placeholder="Search or add your own tag"
          aria-label="Search or add your own tag"
          maxLength={40}
          className={cn(fieldClass, 'pl-12')}
        />
      </div>
      <div role="group" aria-label="Music tags" className="flex flex-wrap gap-2.5">
        {shown.map((t) => {
          const on = selected.some((s) => sameTag(s, t))
          return (
            <Chip key={t} active={on} onClick={() => toggle(t)}>
              {on ? `✓ ${tagLabel(t)}` : tagLabel(t)}
            </Chip>
          )
        })}
        {canAddTyped && (
          <Chip
            onClick={() => {
              onChange([...selected, typed])
              setQuery('')
            }}
          >
            {`+ Add “${typed}”`}
          </Chip>
        )}
      </div>
      {full && <p className="text-meta text-muted-foreground">That's {max}, the most you can pick. Tap one to swap it out.</p>}
    </div>
  )
}

export function StepTags({ userId, profile, setProfile, next, back }: StepProps) {
  const [tags, setTags] = useState(profile.tags.slice(0, TAGS_MAX))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)
    try {
      await setMusicTags(userId, tags)
      setProfile({ tags })
      next()
    } catch (err) {
      setError(errorText(err, "Couldn't save your tags. Try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <SetupFrame
      step={3}
      onBack={back}
      beatie={{ mood: 'thinking', text: "Pick what you're into. It helps BeatBoxed show you reviews and songs you'll like." }}
      title="What do you listen to?"
      subtitle="Pick at least 3, up to 8. These show on your profile."
      footerNote={`${tags.length} selected`}
      primary={{ label: 'Continue', onClick: () => void save(), disabled: tags.length < TAGS_MIN, pending }}
    >
      <TagPicker selected={tags} onChange={setTags} />
      {error && <Alert>{error}</Alert>}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 4 */

function Initial({ name, url, size = 'size-12' }: { name: string; url: string | null; size?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cn(size, 'shrink-0 rounded-full object-cover')} />
  ) : (
    <span className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground')}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export function StepPeople({ profile, next, back }: StepProps) {
  const [people, setPeople] = useState<SuggestedReviewer[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    suggestedReviewers(profile.tags, 5)
      .then((p) => !cancelled && setPeople(p))
      .catch((err) => {
        console.error('[beatboxed] suggested people failed:', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [profile.tags])

  return (
    <SetupFrame
      step={4}
      onBack={back}
      onSkip={next}
      title="Follow a few people"
      subtitle="Their reviews fill your feed. These people like the same music as you."
      primary={{ label: 'Continue', onClick: next }}
    >
      {failed ? (
        <EmptyState face="sad" compact title="Couldn't load suggestions. You can skip this step." />
      ) : people === null ? (
        <SkeletonList rows={5} cover="size-12 rounded-full" />
      ) : people.length === 0 ? (
        <EmptyState face="sleepy" compact title="No suggestions yet. You can find people later in Explore." />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Suggested people">
          {people.map((p) => {
            const name = p.displayName || p.username || 'Listener'
            return (
              <li key={p.id}>
                <Card padding="none" className="flex items-center gap-3 px-4 py-3">
                  <Initial name={name} url={p.avatarUrl} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span dir="auto" className="truncate text-card-title">
                      {name}
                    </span>
                    <span className="text-secondary text-muted-foreground">
                      @{p.username} · {p.reviewCount} {p.reviewCount === 1 ? 'review' : 'reviews'}
                    </span>
                    {p.alsoInto.length > 0 && (
                      <span className="truncate text-secondary font-semibold text-accent">
                        Also into {p.alsoInto.slice(0, 2).map(tagLabel).join(', ')}
                      </span>
                    )}
                  </span>
                  <UserFollowButton personId={p.id} state="none" size="lg" />
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 5 */

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function StepArtists({ profile, next, back }: StepProps) {
  const { isFollowing, toggleFollow } = useFollows()
  const [suggested, setSuggested] = useState<SuggestedArtist[] | null>(null)
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 350)
  const [results, setResults] = useState<SuggestedArtist[] | null>(null)
  // Every artist shown here, so the count includes ones found by search.
  const [seen, setSeen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    suggestedArtists(profile.tags, 9)
      .then((a) => {
        if (cancelled) return
        setSuggested(a)
        setSeen((prev) => new Set([...prev, ...a.map((x) => x.id)]))
      })
      .catch((err) => {
        console.error('[beatboxed] suggested artists failed:', err)
        if (!cancelled) setSuggested([])
      })
    return () => {
      cancelled = true
    }
  }, [profile.tags])

  useEffect(() => {
    if (!debounced) return setResults(null)
    let cancelled = false
    setResults(null)
    searchCatalog(debounced, 'artists', null)
      .then((r) => {
        if (cancelled || r.mode !== 'artists') return
        const found = r.artists.slice(0, 9).map((a) => ({ id: a.id, name: a.name, imageUrl: a.imageUrl ?? null }))
        setResults(found)
        setSeen((prev) => new Set([...prev, ...found.map((x) => x.id)]))
      })
      .catch(() => !cancelled && setResults([]))
    return () => {
      cancelled = true
    }
  }, [debounced])

  const shown = debounced ? results : suggested
  const count = [...seen].filter((id) => isFollowing(id)).length

  return (
    <SetupFrame
      step={5}
      onBack={back}
      onSkip={next}
      title="Follow some artists"
      subtitle="This teaches BeatBoxed your taste. Based on the tags you picked."
      footerNote={count > 0 ? `${count} ${count === 1 ? 'artist' : 'artists'} followed` : undefined}
      primary={{ label: 'Continue', onClick: next }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists"
          aria-label="Search artists"
          className={cn(fieldClass, 'pl-12')}
        />
      </div>
      {shown === null ? (
        <div className="grid grid-cols-3 gap-4" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <span className="aspect-square w-full animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
              <span className="h-3.5 w-2/3 animate-pulse rounded bg-surface motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          face="thinking"
          compact
          title={debounced ? `No artists found for “${debounced}”.` : 'No suggestions yet. Try searching.'}
        />
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-5" aria-label={debounced ? 'Artist results' : 'Suggested artists'}>
          {shown.map((a) => {
            const on = isFollowing(a.id)
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => void toggleFollow(a.id).catch(() => {})}
                  aria-pressed={on}
                  aria-label={`${on ? 'Unfollow' : 'Follow'} ${a.name}`}
                  className="flex w-full flex-col items-center gap-2 rounded-card p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="relative aspect-square w-full">
                    <span
                      className={cn(
                        'block size-full overflow-hidden rounded-full ring-offset-2 ring-offset-background transition-shadow duration-200 ease-soft',
                        on ? 'ring-[3px] ring-primary' : 'ring-0'
                      )}
                    >
                      {a.imageUrl ? (
                        <img src={a.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center bg-surface-2 text-[26px] font-bold">
                          {initials(a.name)}
                        </span>
                      )}
                    </span>
                    {on && (
                      <span className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border-[3px] border-background bg-primary text-white">
                        <Check className="size-4" strokeWidth={3} aria-hidden />
                      </span>
                    )}
                  </span>
                  <span dir="auto" className="line-clamp-2 text-secondary font-semibold">
                    {a.name}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 6 */

function SongRow({
  song,
  liked,
  onToggleLike,
  queue,
  index,
}: {
  song: SongCardModel
  liked: boolean
  onToggleLike: () => void
  queue: SongCardModel[]
  index: number
}) {
  const player = usePlayer()
  const isCurrent = player.current?.id === song.id
  return (
    <Card padding="none" className="flex items-center gap-3 p-3">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-cover bg-surface-2">
        {song.coverUrl ? (
          <img src={song.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Disc3 className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-card-title">
          {song.title}
        </span>
        <span dir="auto" className="truncate text-secondary text-muted-foreground">
          {song.artistName}
        </span>
      </span>
      <button
        type="button"
        onClick={() => (isCurrent ? player.toggle() : player.playQueue(queue, index))}
        aria-label={isCurrent && player.isPlaying ? `Pause ${song.title}` : `Play a preview of ${song.title}`}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
      >
        {isCurrent && player.loading ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2.5} aria-hidden />
        ) : isCurrent && player.isPlaying ? (
          <Pause className="size-4 fill-current" strokeWidth={2} />
        ) : (
          <Play className="size-4 translate-x-px fill-current" strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        onClick={onToggleLike}
        aria-pressed={liked}
        aria-label={liked ? `Unlike ${song.title}` : `Like ${song.title}`}
        className="grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-soft hover:bg-white/5"
      >
        <Heart className={cn('size-6', liked ? 'fill-glow-2 text-glow-2' : 'text-muted-foreground')} strokeWidth={1.75} />
      </button>
    </Card>
  )
}

export function StepSongs({
  userId,
  profile,
  next,
  back,
  liked,
  setLiked,
}: StepProps & {
  liked: Map<string, SongCardModel>
  setLiked: React.Dispatch<React.SetStateAction<Map<string, SongCardModel>>>
}) {
  const [suggestions, setSuggestions] = useState<SongCardModel[] | null>(null)
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 350)
  const [results, setResults] = useState<SongCardModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Songs by the artists they follow (just now, in step 5); by their tags
  // if they follow none. Only songs already in the catalog.
  useEffect(() => {
    let cancelled = false
    getFollowedArtistIds(userId)
      .then((ids) => suggestedSongs([...ids], ids.size ? [] : profile.tags, 5))
      .then((songs) => !cancelled && setSuggestions(songs))
      .catch((err) => {
        console.error('[beatboxed] suggested songs failed:', err)
        if (!cancelled) setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [userId, profile.tags])

  // The same song search the review composer's picker uses.
  useEffect(() => {
    if (!debounced) return setResults(null)
    let current = true
    setResults(null)
    searchCatalog(debounced, 'songs', null, {
      onLocalResults: (songs) => {
        if (current) setResults(songs)
      },
    })
      .then((r) => {
        if (current && r.mode === 'songs') setResults(r.songs)
      })
      .catch(() => {
        if (current) setResults([])
      })
    return () => {
      current = false
    }
  }, [debounced])

  async function toggleLike(song: SongCardModel) {
    const on = liked.has(song.id)
    const flip = (add: boolean) =>
      setLiked((prev) => {
        const nextMap = new Map(prev)
        if (add) nextMap.set(song.id, song)
        else nextMap.delete(song.id)
        return nextMap
      })
    setError(null)
    flip(!on)
    try {
      await setSongLike(userId, song.id, !on)
    } catch {
      flip(on)
      setError("That didn't save. Try again.")
    }
  }

  const list = debounced ? results : suggestions
  const count = liked.size

  return (
    <SetupFrame
      step={6}
      onBack={back}
      onSkip={next}
      title="Like a few songs"
      subtitle="Search any song you love, or pick from the suggestions."
      footerNote={count > 0 ? `${count} ${count === 1 ? 'song' : 'songs'} liked` : undefined}
      primary={{ label: 'Continue', onClick: next }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs or artists"
          aria-label="Search songs or artists"
          className={cn(fieldClass, 'pl-12')}
        />
      </div>
      {!debounced && <p className="text-secondary font-semibold text-muted-foreground">Suggested from your tags and artists</p>}
      {list === null ? (
        <SkeletonList rows={5} cover="size-14" />
      ) : list.length === 0 ? (
        <EmptyState
          face="thinking"
          compact
          title={debounced ? `No songs found for “${debounced}”.` : 'No suggestions yet. Try searching for a song you love.'}
        />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label={debounced ? 'Search results' : 'Suggested songs'}>
          {list.map((s, i) => (
            <li key={s.id}>
              <SongRow song={s} liked={liked.has(s.id)} onToggleLike={() => void toggleLike(s)} queue={list} index={i} />
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- step 7 */

export function StepReview({ userId, next, back, liked }: StepProps & { liked: Map<string, SongCardModel> }) {
  const songs = [...liked.values()]
  const [songId, setSongId] = useState(songs[0]?.id ?? null)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const song = songs.find((s) => s.id === songId) ?? null

  async function post() {
    if (!song || rating === 0) return
    setPending(true)
    setError(null)
    try {
      // The same save as everywhere else: short text is kept with the
      // rating; it just doesn't show in the feed.
      await upsertReview({ songId: song.id, userId, rating, title, body, isEdit: false })
      next()
    } catch {
      setError("Couldn't post your review. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <SetupFrame
      step={7}
      onBack={back}
      onSkip={next}
      title="Write your first review"
      subtitle="Pick one of the songs you liked. A few words is enough."
      primary={{ label: 'Post review', onClick: () => void post(), disabled: !song || rating === 0, pending }}
      secondary={{ label: 'Skip for now', onClick: next }}
    >
      {songs.length === 0 ? (
        <EmptyState
          face="thinking"
          compact
          title="You haven't liked any songs yet."
          detail="Go back to like a few, or skip this and review one later."
        />
      ) : (
        <>
          <ScrollRow as="div" size="sm" role="group" aria-label="Song to review" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2">
            {songs.map((s) => (
              <Chip key={s.id} active={s.id === songId} onClick={() => setSongId(s.id)}>
                {s.title}
              </Chip>
            ))}
          </ScrollRow>
          {song && (
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-4">
                <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-cover bg-surface-2">
                  {song.coverUrl ? (
                    <img src={song.coverUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Disc3 className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span dir="auto" className="truncate text-card-title">
                    {song.title}
                  </span>
                  <span dir="auto" className="truncate text-secondary text-muted-foreground">
                    {song.artistName}
                  </span>
                </span>
              </div>
              <StarInput value={rating} onChange={setRating} />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                aria-label="Title"
                maxLength={100}
                dir="auto"
                className={cn(fieldClass, 'bg-surface-2 font-semibold')}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What do you hear in it?"
                aria-label="Your review"
                rows={4}
                dir="auto"
                className={cn(fieldClass, 'resize-none bg-surface-2')}
              />
              <p className="text-meta text-muted-foreground">
                Reviews under {FEED_MIN_BODY_CHARS} characters won't show in the feed.
              </p>
            </Card>
          )}
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </SetupFrame>
  )
}

/* ---------------------------------------------------------------- all set */

export function AllSetStep({ userId, profile, likedCount }: StepProps & { likedCount: number }) {
  const navigate = useNavigate()
  const { patch } = useOnboarding()
  const [counts, setCounts] = useState<{ people: number; artists: number; liked: number; reviews: number } | null>(null)
  const [pending, setPending] = useState<'tour' | 'skip' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = profile.displayName || profile.username

  useEffect(() => {
    let cancelled = false
    setupCounts(userId)
      .then((c) => !cancelled && setCounts(c))
      .catch(() => !cancelled && setCounts({ people: 0, artists: 0, liked: likedCount, reviews: 0 }))
    return () => {
      cancelled = true
    }
  }, [userId, likedCount])

  async function finish(choice: 'tour' | 'skip') {
    setPending(choice)
    setError(null)
    try {
      await completeSetup(userId)
      if (choice === 'skip') await markTour(userId, 'skipped')
      const now = new Date().toISOString()
      patch({
        setupCompletedAt: now,
        setupStep: SETUP_ALL_SET,
        welcomeCardDismissedAt: now,
        ...(choice === 'skip' ? { tutorialSkippedAt: now } : {}),
      })
      // Skipping counts as ending the tour, so Home says "You're ready!".
      navigate(choice === 'tour' ? '/?tour=1' : '/', { replace: true, state: choice === 'skip' ? { tourEnded: true } : null })
    } catch {
      setError("Couldn't finish setup. Try again.")
      setPending(null)
    }
  }

  const stat = (n: number | undefined, one: string, many: string) => (
    <div className="flex flex-col items-center gap-0.5">
      <dt className="order-2 text-meta text-muted-foreground">{n === 1 ? one : many}</dt>
      <dd className="order-1 text-[22px] font-bold tabular-nums">{n ?? '–'}</dd>
    </div>
  )

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-6">
      <main className="animate-page-in flex flex-1 flex-col items-center gap-3 text-center motion-reduce:animate-none">
        <BeatieImage mood="excited" size={120} />
        <h1 className="mt-2 text-page-title">You're all set, {name}!</h1>
        <p className="text-body text-muted-foreground">Here's how your profile looks to others.</p>

        <Card className="mt-4 flex w-full flex-col gap-4 p-5 text-left">
          <div className="flex items-center gap-4">
            <Initial name={name} url={profile.avatarUrl} size="size-16" />
            <span className="flex min-w-0 flex-col">
              <span dir="auto" className="truncate text-section-title">
                {name}
              </span>
              <span className="truncate text-secondary text-muted-foreground">@{profile.username}</span>
            </span>
          </div>
          {profile.bio && (
            <p dir="auto" className="text-body text-foreground/90">
              {profile.bio}
            </p>
          )}
          {profile.tags.length > 0 && (
            <ul aria-label="Music tags" className="flex flex-wrap gap-2">
              {profile.tags.map((t) => (
                <li key={t}>
                  <span className="inline-flex min-h-9 items-center rounded-chip bg-primary/20 px-3.5 text-button text-accent">
                    {tagLabel(t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-4 gap-2 border-t border-line pt-4">
            {stat(counts?.people, 'person', 'people')}
            {stat(counts?.artists, 'artist', 'artists')}
            {stat(counts?.liked, 'liked song', 'liked songs')}
            {stat(counts?.reviews, 'review', 'reviews')}
          </dl>
        </Card>
      </main>

      <footer className="mt-8 flex flex-col items-center gap-3">
        <p className="text-card-title">Want me to show you around? It takes 30 seconds.</p>
        <button
          type="button"
          onClick={() => void finish('tour')}
          disabled={pending !== null}
          className="flex min-h-13 w-full items-center justify-center gap-2 rounded-chip bg-primary px-6 text-[17px] font-semibold text-white transition-all duration-200 ease-soft hover:bg-accent disabled:opacity-60"
        >
          {pending === 'tour' && <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />}
          Show me around
        </button>
        <button
          type="button"
          onClick={() => void finish('skip')}
          disabled={pending !== null}
          className="flex min-h-13 w-full items-center justify-center gap-2 rounded-chip border border-line-strong px-6 text-[17px] font-semibold text-foreground transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-60"
        >
          {pending === 'skip' && <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />}
          Skip, I'll explore on my own
        </button>
        {error && <Alert>{error}</Alert>}
      </footer>
    </div>
  )
}
