import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader2, Send } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { addReviewComment, getReviewComments } from '@/lib/catalog'
import type { ReviewComment } from '@/lib/types'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** Each step is [upper bound in seconds, unit, seconds per unit]. */
const STEPS: [number, Intl.RelativeTimeFormatUnit, number][] = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
  [2629800, 'week', 604800],
  [31557600, 'month', 2629800],
]

function timeAgo(iso: string) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  for (const [limit, unit, per] of STEPS) {
    if (seconds < limit) return relative.format(-Math.round(seconds / per), unit)
  }
  return relative.format(-Math.round(seconds / 31557600), 'year')
}

export function ReviewComments({
  reviewId,
  onCountChange,
}: {
  reviewId: string
  onCountChange: (delta: number) => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [comments, setComments] = useState<ReviewComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getReviewComments(reviewId)
      .then((c) => {
        if (!cancelled) setComments(c)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] comments lookup failed:', err)
        if (!cancelled) {
          setComments([])
          setError("Couldn't load comments.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [reviewId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return

    if (!user) {
      navigate('/login', { state: { from: location.pathname } })
      return
    }

    setPosting(true)
    setError(null)
    try {
      const created = await addReviewComment(reviewId, user.id, body)
      setComments((c) => [...(c ?? []), created])
      setDraft('')
      onCountChange(1)
    } catch (err) {
      console.error('[beatboxed] comment failed:', err)
      setError("Couldn't post your comment. Try again.")
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="animate-fade-in mt-3 flex flex-col gap-3 border-t border-white/5 pt-3">
      {comments === null ? (
        <div className="flex items-center gap-2 text-secondary text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
          Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <p className="text-secondary text-muted-foreground">
          No comments yet.
        </p>
      ) : (
        comments.map((c) => {
          const name = c.author?.displayName || c.author?.username || 'Someone'
          return (
            <div key={c.id} className="flex gap-2.5">
              {c.author?.avatarUrl ? (
                <img
                  src={c.author.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="size-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-meta text-muted-foreground">
                  {name.trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
              <div className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-secondary font-medium">{name}</span>
                  <span className="text-meta text-muted-foreground">
                    {timeAgo(c.createdAt)}
                    {c.edited && ' · edited'}
                  </span>
                </span>
                <p dir="auto" className="text-secondary text-muted-foreground">
                  {c.body}
                </p>
              </div>
            </div>
          )
        })
      )}

      {error && <p className="text-meta text-danger">{error}</p>}

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={posting}
          dir="auto"
          maxLength={500}
          placeholder={user ? 'Add a comment…' : 'Log in to comment'}
          aria-label="Add a comment"
          className="min-w-0 flex-1 rounded-button border border-white/5 bg-surface px-3 py-2 text-secondary text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={posting || !draft.trim()}
          aria-label="Post comment"
          className="grid size-9 shrink-0 place-items-center rounded-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground disabled:opacity-40"
        >
          {posting ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          ) : (
            <Send className="size-4" strokeWidth={1.75} />
          )}
        </button>
      </form>
    </div>
  )
}
