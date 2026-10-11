import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { StarInput } from '@/components/ui/StarInput'
import { Artwork } from './Artwork'
import { SongPicker } from './SongPicker'
import { useAuth } from '@/lib/auth'
import { upsertReview } from '@/lib/catalog'
import { FEED_MIN_CHARS, feedLength, getMyReviews, type FeedReview } from '@/lib/feed'
import type { ReviewWithAuthor, SongCardModel } from '@/lib/types'

const HEADLINE_MAX = 80

/**
 * "New review": pick a song, then write about it.
 *
 * Step 1 is the shared SongPicker, with a "Reviewed" badge on songs the user
 * has already written about. Step 2 is the review itself; Post stays
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
  const titleId = useId()
  const listId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const starsRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<1 | 2>(1)
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState<Map<string, ReviewWithAuthor>>(new Map())

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
    setChosen(null)
    setExisting(null)
    setRating(0)
    setHeadline('')
    setBody('')
    setPostError(null)
    setConfirmingDiscard(false)
  }, [open])

  // Which offered songs the user has already reviewed — the "Reviewed"
  // badge, and what opens for editing instead of a blank form.
  const lookUpMine = useCallback(
    (ids: string[]) => {
      if (!user || ids.length === 0) return
      getMyReviews(user.id, ids)
        .then((m) => setMine((prev) => new Map([...prev, ...m])))
        .catch((err: unknown) => console.warn('[beatboxed] own reviews lookup failed:', err))
    },
    [user]
  )

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
          <SongPicker
            query={query}
            onQueryChange={setQuery}
            onPick={pick}
            inputRef={searchRef}
            onOptionIdsChange={lookUpMine}
            renderBadge={(song) =>
              mine.has(song.id) ? (
                <span className="shrink-0 rounded-full bg-star/15 px-2.5 py-1 text-meta text-star">
                  Reviewed
                </span>
              ) : null
            }
          />
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
