import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, AudioLines, Check, ChevronRight, Loader2, Search, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { StarInput } from '@/components/ui/StarInput'
import { Artwork } from './Artwork'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { normalizeSearch, searchCatalog, upsertReview } from '@/lib/catalog'
import { FEED_MIN_CHARS, feedLength, getMyReviews, type FeedReview } from '@/lib/feed'
import { cn } from '@/lib/cn'
import type { ReviewWithAuthor, SongCardModel } from '@/lib/types'

const HEADLINE_MAX = 80

type Option = { song: SongCardModel; group: 'now-playing' | 'results' }

/**
 * "New review": pick a song, then write about it.
 *
 * Step 1 is a combobox — the search input and its listbox share one border
 * so they read as one control — over the same searchCatalog() that Explore
 * uses, including its Spotify top-up. Step 2 is the review itself; Post stays
 * off until there's a rating and FEED_MIN_CHARS of written text, because
 * anything shorter wouldn't appear in the feed it was written from.
 *
 * Every way out (✕, Escape, the backdrop) goes through requestClose(), which
 * asks before throwing away unsaved text.
 */
export function ReviewComposer({
  open,
  onClose,
  onPosted,
}: {
  open: boolean
  onClose: () => void
  /** The saved review, with its song, so the feed can show it at once. */
  onPosted: (review: FeedReview, wasEdit: boolean) => void
}) {
  const { user } = useAuth()
  const player = usePlayer()
  const titleId = useId()
  const listId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const starsRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<1 | 2>(1)
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 250)
  const [results, setResults] = useState<SongCardModel[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [mine, setMine] = useState<Map<string, ReviewWithAuthor>>(new Map())
  const [active, setActive] = useState(-1)

  const [chosen, setChosen] = useState<SongCardModel | null>(null)
  const [existing, setExisting] = useState<ReviewWithAuthor | null>(null)
  const [rating, setRating] = useState(0)
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // Each opening starts clean; a posted or discarded draft doesn't come back.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setQuery('')
    setResults(null)
    setActive(-1)
    setChosen(null)
    setExisting(null)
    setRating(0)
    setHeadline('')
    setBody('')
    setPostError(null)
    setConfirmingDiscard(false)
  }, [open])

  // Search: cached matches first, then whatever the Spotify top-up adds.
  useEffect(() => {
    const q = debounced.trim()
    if (!open || !q) {
      setResults(null)
      setSearching(false)
      setToppingUp(false)
      setSearchError(false)
      return
    }
    let current = true
    setSearching(true)
    setSearchError(false)
    searchCatalog(q, 'songs', null, {
      onLocalResults: (songs) => {
        if (!current) return
        setResults(songs)
        setToppingUp(true)
      },
    })
      .then((r) => {
        if (current && r.mode === 'songs') setResults(r.songs)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] composer search failed:', err)
        if (current) setSearchError(true)
      })
      .finally(() => {
        if (!current) return
        setSearching(false)
        setToppingUp(false)
      })
    return () => {
      current = false
    }
  }, [debounced, open])

  const nowPlaying = player.current
  const options: Option[] = useMemo(() => {
    const list: Option[] = []
    if (nowPlaying) list.push({ song: nowPlaying, group: 'now-playing' })
    for (const song of results ?? []) {
      // Already offered under Now playing; once is enough.
      if (song.id !== nowPlaying?.id) list.push({ song, group: 'results' })
    }
    return list
  }, [nowPlaying, results])

  // Which of these the user has already reviewed — the "Reviewed" badge, and
  // what opens for editing instead of a blank form.
  const optionIds = options.map((o) => o.song.id).join(',')
  useEffect(() => {
    if (!user || !optionIds) return
    let current = true
    getMyReviews(user.id, optionIds.split(','))
      .then((m) => {
        if (current) setMine((prev) => new Map([...prev, ...m]))
      })
      .catch((err: unknown) => console.warn('[beatboxed] own reviews lookup failed:', err))
    return () => {
      current = false
    }
  }, [user, optionIds])

  // A new result list starts with nothing highlighted.
  useEffect(() => setActive(-1), [results])

  const typed = query.trim().length > 0
  const listOpen = options.length > 0 || (typed && (results !== null || searching || searchError))

  function pick(song: SongCardModel) {
    const theirs = mine.get(song.id) ?? null
    if (theirs) {
      setRating(theirs.rating)
      setHeadline(theirs.title ?? '')
      setBody(theirs.body ?? '')
    } else if (existing) {
      // Moving off a review that was loaded for editing: that text belongs
      // to the other song, so start this one fresh.
      setRating(0)
      setHeadline('')
      setBody('')
    }
    setExisting(theirs)
    setChosen(song)
    setPostError(null)
    setStep(2)
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (options.length) setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[active] ?? (options.length === 1 ? options[0] : undefined)
      if (option) pick(option.song)
    } else if (e.key === 'Escape' && (query || active >= 0)) {
      // First Escape clears the search; a second one closes the sheet.
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
      setActive(-1)
    }
  }

  // Back to step 1: the search is still there, and the cursor is in it.
  useEffect(() => {
    if (!open) return
    if (step === 1) searchRef.current?.focus()
    else starsRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [step, open])

  const length = feedLength(body)
  const longEnough = length >= FEED_MIN_CHARS
  const canPost = rating > 0 && longEnough && !posting

  const dirty = existing
    ? rating !== existing.rating ||
      headline !== (existing.title ?? '') ||
      body !== (existing.body ?? '')
    : headline.trim() !== '' || body.trim() !== ''

  function requestClose() {
    if (posting) return
    if (confirmingDiscard) return setConfirmingDiscard(false)
    if (dirty) return setConfirmingDiscard(true)
    onClose()
  }

  async function post() {
    if (!user || !chosen || !canPost) return
    setPosting(true)
    setPostError(null)
    try {
      const saved = await upsertReview({
        songId: chosen.id,
        userId: user.id,
        rating,
        title: headline,
        body,
        isEdit: Boolean(existing),
      })
      onPosted({ ...saved, song: chosen }, Boolean(existing))
    } catch (err) {
      console.error('[beatboxed] posting review failed:', err)
      // Stay open with everything kept, so nothing typed is lost.
      setPostError("Couldn't post your review. Check your connection and try again.")
    } finally {
      setPosting(false)
    }
  }

  const activeId = active >= 0 ? `${listId}-opt-${active}` : undefined
  const words = useMemo(() => normalizeSearch(query).split(' ').filter(Boolean), [query])

  return (
    <Modal
      open={open}
      onClose={requestClose}
      labelledBy={titleId}
      initialFocus={searchRef}
      className="h-[92dvh] sm:h-auto sm:min-h-[560px]"
    >
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 px-5 pb-3 pt-3 sm:pt-5">
        <div className="flex items-center gap-2">
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              aria-label="Back to song search"
              className="-ml-2 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <ArrowLeft className="size-5" strokeWidth={1.75} />
            </button>
          )}
          <h2 id={titleId} className="flex-1 text-section-title">
            {existing && step === 2 ? 'Edit review' : 'New review'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="-mr-2 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <StepIndicator step={step} />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <label htmlFor={`${listId}-search`} className="text-secondary text-muted-foreground">
              Which song is this about?
            </label>
            {/* One bordered control: the input, and the list hanging off it. */}
            <div
              className={cn(
                'overflow-hidden rounded-card border bg-surface-2 transition-colors duration-200 ease-soft',
                'border-white/10 focus-within:border-primary/70'
              )}
            >
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  id={`${listId}-search`}
                  type="text"
                  role="combobox"
                  aria-expanded={Boolean(listOpen)}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId}
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search for a song or artist"
                  className="w-full bg-transparent py-3.5 pl-11 pr-4 text-body text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
              </div>

              {listOpen && (
                <div className="border-t border-white/5">
                  <ul id={listId} role="listbox" aria-label="Songs" className="flex flex-col py-1">
                    {options.map((o, i) => (
                      <Fragment key={`${o.group}-${o.song.id}`}>
                        {(i === 0 || options[i - 1].group !== o.group) && (
                          <li
                            role="presentation"
                            className={cn(
                              'px-4 pb-1.5 pt-2.5 text-meta uppercase tracking-wide text-muted-foreground',
                              i > 0 && 'mt-1 border-t border-white/5'
                            )}
                          >
                            {o.group === 'now-playing' ? 'Now playing' : 'Songs'}
                          </li>
                        )}
                        <SongOption
                          id={`${listId}-opt-${i}`}
                          song={o.song}
                          words={o.group === 'results' ? words : []}
                          active={i === active}
                          reviewed={mine.has(o.song.id)}
                          nowPlaying={o.group === 'now-playing'}
                          onHover={() => setActive(i)}
                          onPick={() => pick(o.song)}
                        />
                      </Fragment>
                    ))}
                  </ul>

                  {typed && searchError && (
                    <p className="px-4 py-3 text-secondary text-danger">
                      Search failed. Check your connection and try again.
                    </p>
                  )}
                  {typed && !searching && !searchError && results?.length === 0 && (
                    <p className="px-4 py-3 text-secondary text-muted-foreground">
                      No songs found. Try adding the artist's name.
                    </p>
                  )}
                  {typed && (toppingUp || (searching && results === null)) && (
                    <p
                      role="status"
                      className="flex items-center gap-2 border-t border-white/5 px-4 py-3 text-secondary text-muted-foreground"
                    >
                      <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                      {toppingUp ? 'Looking on Spotify for more matches…' : 'Searching…'}
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-secondary text-muted-foreground">
              Tip: add the artist to narrow it down, like “karma radiohead”.
            </p>
          </div>
        ) : chosen ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-card bg-surface-2 p-3">
              <Artwork src={chosen.coverUrl} seed={chosen.id} className="size-14" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span dir="auto" className="truncate text-card-title">
                  {chosen.title}
                </span>
                <span className="truncate text-secondary text-muted-foreground">
                  {[chosen.artistName, chosen.albumTitle].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="shrink-0 rounded-button bg-white/5 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/10 hover:text-foreground"
              >
                Change
              </button>
            </div>

            <div className="flex flex-col gap-2" ref={starsRef}>
              <span className="text-secondary text-muted-foreground">Your rating</span>
              <div className="flex items-center gap-3">
                <StarInput value={rating} onChange={setRating} disabled={posting} />
                {rating > 0 && (
                  <span className="text-button text-star" aria-hidden>
                    {rating}/5
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={`${listId}-headline`} className="text-secondary text-muted-foreground">
                Headline (optional)
              </label>
              <input
                id={`${listId}-headline`}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={HEADLINE_MAX}
                disabled={posting}
                dir="auto"
                placeholder="Sum up your take in a line"
                className="w-full rounded-button border border-white/10 bg-surface-2 px-3.5 py-3 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 focus:border-primary/70 focus:outline-none disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={`${listId}-body`} className="text-secondary text-muted-foreground">
                Your review
              </label>
              <textarea
                id={`${listId}-body`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={posting}
                rows={6}
                dir="auto"
                placeholder="What did you hear? What stayed with you?"
                aria-describedby={`${listId}-progress`}
                className="w-full resize-none rounded-card border border-white/10 bg-surface-2 px-3.5 py-3 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 focus:border-primary/70 focus:outline-none disabled:opacity-60"
              />
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Length for the feed"
                aria-valuemin={0}
                aria-valuemax={FEED_MIN_CHARS}
                aria-valuenow={Math.min(length, FEED_MIN_CHARS)}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-soft"
                  style={{ width: `${Math.min(1, length / FEED_MIN_CHARS) * 100}%` }}
                />
              </div>
              <div
                id={`${listId}-progress`}
                className="flex items-center justify-between gap-3 text-meta text-muted-foreground"
              >
                {longEnough ? (
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3.5 text-success" strokeWidth={2.25} aria-hidden />
                    <span className="sr-only">Long enough to appear in the feed</span>
                  </span>
                ) : (
                  <span>Write a little more so it can appear in the feed</span>
                )}
                <span data-testid="composer-counter" className="tabular-nums">
                  {longEnough ? length : `${length} / ${FEED_MIN_CHARS}`}
                </span>
              </div>
            </div>

            {postError && (
              <p role="alert" className="text-body text-danger">
                {postError}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Footer: only on step 2, where there's something to post. */}
      {step === 2 && (
        <div className="shrink-0 border-t border-white/5 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={() => void post()}
            disabled={!canPost}
            className="flex w-full items-center justify-center gap-2 rounded-button bg-primary px-4 py-3.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          >
            {posting && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
            {existing ? 'Save changes' : 'Post review'}
          </button>
        </div>
      )}

      {confirmingDiscard && (
        <DiscardConfirm
          onKeep={() => setConfirmingDiscard(false)}
          onDiscard={() => {
            setConfirmingDiscard(false)
            onClose()
          }}
        />
      )}
    </Modal>
  )
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-3 text-meta" aria-label="Steps">
      <li
        aria-current={step === 1 ? 'step' : undefined}
        className={step === 1 ? 'text-foreground' : 'text-muted-foreground'}
      >
        1 Pick a song
      </li>
      <li aria-hidden className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-soft"
          style={{ width: step === 1 ? '50%' : '100%' }}
        />
      </li>
      <li
        aria-current={step === 2 ? 'step' : undefined}
        className={step === 2 ? 'text-foreground' : 'text-muted-foreground'}
      >
        2 Write
      </li>
    </ol>
  )
}

function SongOption({
  id,
  song,
  words,
  active,
  reviewed,
  nowPlaying,
  onHover,
  onPick,
}: {
  id: string
  song: SongCardModel
  words: string[]
  active: boolean
  reviewed: boolean
  nowPlaying: boolean
  onHover: () => void
  onPick: () => void
}) {
  // Scroll the keyboard's current option into view inside the sheet.
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      // mousedown, not click: keeps focus in the input, as a combobox should.
      onMouseDown={(e) => {
        e.preventDefault()
        onPick()
      }}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-150 ease-soft',
        active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
      )}
    >
      <Artwork src={song.coverUrl} seed={song.id} className="size-11" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-card-title">
          <Highlighted text={song.title} words={words} />
        </span>
        <span className="truncate text-secondary text-muted-foreground">
          {[song.artistName, song.albumTitle].filter(Boolean).join(' · ')}
        </span>
      </span>
      {reviewed ? (
        <span className="shrink-0 rounded-full bg-star/15 px-2.5 py-1 text-meta text-star">
          Reviewed
        </span>
      ) : nowPlaying ? (
        <AudioLines className="size-4 shrink-0 text-primary" strokeWidth={2} aria-label="Playing" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      )}
    </li>
  )
}

/** The title with the typed words picked out in the accent colour. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-transparent text-accent">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}

function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const titleId = useId()
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => keepRef.current?.focus(), [])

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center rounded-[inherit] bg-black/50 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-fade-in flex w-full max-w-sm flex-col gap-4 rounded-card bg-surface-2 p-5 shadow-card"
      >
        <p id={titleId} className="text-card-title">
          Discard this review?
        </p>
        <p className="-mt-2 text-secondary text-muted-foreground">
          What you've written so far will be lost.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-button bg-danger/15 px-4 py-2.5 text-button text-danger transition-colors duration-200 ease-soft hover:bg-danger/25"
          >
            Discard
          </button>
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            className="rounded-button px-4 py-2.5 text-button text-muted-foreground hover:text-foreground sm:mr-auto"
          >
            Keep writing
          </button>
        </div>
      </div>
    </div>
  )
}
