import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { StarInput } from '@/components/ui/StarInput'
import { FormAlert } from '@/components/auth/FormAlert'
import type { ReviewWithAuthor } from '@/lib/types'

export function ReviewForm({
  existing,
  onSubmit,
  onCancel,
}: {
  existing: ReviewWithAuthor | null
  onSubmit: (
    rating: number,
    title: string | null,
    body: string | null
  ) => Promise<void>
  onCancel: () => void
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (rating < 1) {
      setError('Pick a star rating first.')
      return
    }
    setError(null)
    setPending(true)
    try {
      await onSubmit(
        rating,
        title.trim() ? title.trim() : null,
        body.trim() ? body.trim() : null
      )
    } catch (err) {
      console.error('[beatboxed] review submit failed:', err)
      setError("Couldn't save your review. Check your connection and try again.")
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-fade-in flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card"
    >
      <h3 className="text-card-title">
        {existing ? 'Edit your review' : 'Write a review'}
      </h3>

      {error && <FormAlert tone="error">{error}</FormAlert>}

      <StarInput value={rating} onChange={setRating} disabled={pending} />

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={pending}
        dir="auto"
        maxLength={80}
        placeholder="Give it a title (optional)"
        aria-label="Review title"
        className="w-full rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
      />

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        rows={4}
        dir="auto"
        placeholder="What did you think? (optional)"
        aria-label="Your review"
        className="w-full resize-y rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
          {existing ? 'Save changes' : 'Post review'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-button bg-surface-2 px-4 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/10 hover:text-foreground active:scale-[0.98] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
