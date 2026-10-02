import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader2, PenLine, Trash2 } from 'lucide-react'
import { ReviewCard } from './ReviewCard'
import { ReviewForm } from './ReviewForm'
import { FormAlert } from '@/components/auth/FormAlert'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/hooks/useProfile'
import { deleteReview, getSongReviews, upsertReview } from '@/lib/catalog'
import type { ReviewWithAuthor } from '@/lib/types'

const PAGE_SIZE = 10

export function ReviewsTab({
  songId,
  onStatsChange,
  targetReviewId,
  targetCommentId,
}: {
  songId: string
  /** Fires after any successful write so the header average can refresh. */
  onStatsChange: () => void
  /** From ?review= on a notification deep link. */
  targetReviewId?: string | null
  /** From &comment= — opens that review's thread as well. */
  targetCommentId?: string | null
}) {
  const { user } = useAuth()
  const { displayName } = useProfile()
  const navigate = useNavigate()
  const location = useLocation()

  const [reviews, setReviews] = useState<ReviewWithAuthor[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReviews(null)
    getSongReviews(songId, { limit: PAGE_SIZE, viewerId: user?.id })
      .then(({ reviews: r, total: t }) => {
        if (cancelled) return
        setReviews(r)
        setTotal(t)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] reviews lookup failed:', err)
        if (!cancelled) {
          setReviews([])
          setTotal(0)
        }
      })
    return () => {
      cancelled = true
    }
  }, [songId, user?.id])

  /** Re-read everything already on screen, so a write can't desync the list. */
  const refreshLoaded = useCallback(
    async (loadedCount: number) => {
      const { reviews: r, total: t } = await getSongReviews(songId, {
        limit: Math.max(loadedCount, PAGE_SIZE),
        viewerId: user?.id,
      })
      setReviews(r)
      setTotal(t)
    },
    [songId, user?.id]
  )

  async function loadMore() {
    if (!reviews) return
    setLoadingMore(true)
    try {
      const { reviews: next, total: t } = await getSongReviews(songId, {
        limit: PAGE_SIZE,
        offset: reviews.length,
        viewerId: user?.id,
      })
      // Guard against a row shifting pages if someone posts mid-scroll.
      const seen = new Set(reviews.map((r) => r.id))
      setReviews([...reviews, ...next.filter((r) => !seen.has(r.id))])
      setTotal(t)
    } catch (err) {
      console.error('[beatboxed] load more failed:', err)
      setError("Couldn't load more reviews.")
    } finally {
      setLoadingMore(false)
    }
  }

  const myReview = user ? (reviews?.find((r) => r.userId === user.id) ?? null) : null
  const others = reviews?.filter((r) => r.userId !== user?.id) ?? []

  function startWriting() {
    // Sending an anonymous user to a form they can't submit is a dead end.
    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }
    setError(null)
    setFormOpen(true)
  }

  async function handleSubmit(
    rating: number,
    title: string | null,
    body: string | null
  ) {
    if (!user) return
    const isEdit = Boolean(myReview)
    const previous = reviews ?? []

    // Optimistic: show it immediately, then reconcile with the server so a
    // concurrent review from someone else doesn't get lost.
    const optimistic: ReviewWithAuthor = {
      id: myReview?.id ?? `pending-${user.id}`,
      userId: user.id,
      rating,
      title,
      body,
      createdAt: myReview?.createdAt ?? new Date().toISOString(),
      edited: isEdit,
      // Editing keeps existing engagement; a new review starts at zero.
      likeCount: myReview?.likeCount ?? 0,
      likedByMe: myReview?.likedByMe ?? false,
      commentCount: myReview?.commentCount ?? 0,
      author: myReview?.author ?? {
        username: null,
        displayName,
        avatarUrl: null,
      },
    }
    setReviews(
      isEdit
        ? previous.map((r) => (r.userId === user.id ? optimistic : r))
        : [optimistic, ...previous]
    )
    if (!isEdit) setTotal((t) => t + 1)

    try {
      await upsertReview({
        songId,
        userId: user.id,
        rating,
        title,
        body,
        isEdit,
      })
      setFormOpen(false)
      await refreshLoaded(previous.length + (isEdit ? 0 : 1))
      onStatsChange()
    } catch (err) {
      setReviews(previous)
      if (!isEdit) setTotal((t) => Math.max(0, t - 1))
      throw err // ReviewForm keeps itself open and shows the message
    }
  }

  async function handleDelete() {
    if (!user) return
    const previous = reviews ?? []
    setConfirmingDelete(false)
    setDeleting(true)
    setReviews(previous.filter((r) => r.userId !== user.id))
    setTotal((t) => Math.max(0, t - 1))

    try {
      await deleteReview(songId, user.id)
      await refreshLoaded(Math.max(previous.length - 1, PAGE_SIZE))
      onStatsChange()
    } catch (err) {
      console.error('[beatboxed] review delete failed:', err)
      setReviews(previous)
      setTotal((t) => t + 1)
      setError("Couldn't delete your review. Try again.")
    } finally {
      setDeleting(false)
    }
  }

  if (reviews === null) {
    return (
      <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
        Loading reviews…
      </div>
    )
  }

  const hasMore = reviews.length < total

  return (
    <div className="flex flex-col gap-4">
      {error && <FormAlert tone="error">{error}</FormAlert>}

      {formOpen ? (
        <ReviewForm
          existing={myReview}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      ) : myReview ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-2 p-4">
          <p className="text-meta text-muted-foreground">Your review</p>
          <ReviewCard
            review={myReview}
            highlight={myReview.id === targetReviewId}
            openComments={Boolean(targetCommentId) && myReview.id === targetReviewId}
          />

          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-secondary text-foreground">
                Delete your review?
              </span>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-button bg-danger/15 px-3.5 py-2 text-button text-danger transition-all duration-200 ease-soft hover:bg-danger/25 active:scale-[0.98]"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-button px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-2 rounded-button bg-surface px-3.5 py-2 text-button text-muted-foreground transition-all duration-200 ease-soft hover:text-foreground active:scale-[0.98]"
              >
                <PenLine className="size-4" strokeWidth={1.75} />
                Edit your review
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={deleting}
                className="flex items-center gap-2 rounded-button px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger disabled:opacity-60"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                ) : (
                  <Trash2 className="size-4" strokeWidth={1.75} />
                )}
                Delete
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={startWriting}
          className="flex items-center justify-center gap-2 rounded-card bg-surface px-5 py-4 text-button text-foreground shadow-card transition-all duration-200 ease-soft hover:bg-surface-2 active:scale-[0.99]"
        >
          <PenLine className="size-[18px] text-primary" strokeWidth={1.75} />
          Write a review
        </button>
      )}

      {others.length === 0 && !myReview ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
          <p className="text-card-title">No reviews yet</p>
          <p className="max-w-sm text-body text-muted-foreground">
            Be the first to rate this song.
          </p>
        </div>
      ) : (
        others.map((r) => (
          <ReviewCard
            key={r.id}
            review={r}
            highlight={r.id === targetReviewId}
            openComments={Boolean(targetCommentId) && r.id === targetReviewId}
          />
        ))
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="flex items-center justify-center gap-2 rounded-button bg-surface px-4 py-3 text-button text-muted-foreground shadow-card transition-all duration-200 ease-soft hover:bg-surface-2 hover:text-foreground active:scale-[0.99] disabled:opacity-60"
        >
          {loadingMore && (
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          )}
          Load more reviews ({total - reviews.length} left)
        </button>
      )}
    </div>
  )
}
