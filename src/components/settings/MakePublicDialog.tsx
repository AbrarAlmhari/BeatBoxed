import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { getPendingRequestSummary } from '@/lib/catalog'
import type { PersonCardModel } from '@/lib/types'

type Summary = { count: number; people: PersonCardModel[] }

const TITLE_ID = 'make-public-title'

/**
 * The warning before a private account goes public.
 *
 * Going public isn't only a visibility change: the database accepts every
 * pending follow request the moment is_private flips (0027's
 * accept_requests_on_public trigger). That can't be undone by switching back,
 * so the user sees who's waiting before it happens.
 *
 * This only ever reports a choice. The caller saves the setting, and the
 * trigger does the accepting — nothing here accepts a request itself.
 */
export function MakePublicDialog({
  open,
  userId,
  onConfirm,
  onCancel,
  onReviewRequests,
}: {
  open: boolean
  userId: string
  onConfirm: () => void
  /** Cancel, Escape and the backdrop all land here: the account stays private. */
  onCancel: () => void
  onReviewRequests: () => void
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Fresh every time it opens, never from earlier page data, so a request
  // that arrived since Settings loaded is counted.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSummary(null)
    setError(false)
    getPendingRequestSummary(userId)
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] pending request count failed:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, userId, attempt])

  const count = summary?.count ?? 0
  const others = count - (summary?.people.length ?? 0)

  return (
    <Modal open={open} onClose={onCancel} labelledBy={TITLE_ID}>
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id={TITLE_ID} className="text-section-title">
          Make your account public?
        </h2>

        {error ? (
          <p className="text-body text-danger">
            Couldn't check your follow requests.{' '}
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="text-button text-accent underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </p>
        ) : summary === null ? (
          <div
            className="flex items-center gap-2 text-body text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            Checking your follow requests…
          </div>
        ) : count > 0 ? (
          <>
            <p className="text-body text-muted-foreground" data-testid="make-public-text">
              You have {count} pending follow {count === 1 ? 'request' : 'requests'}.
              Making your account public will accept all of them, and anyone will
              be able to see your reviews and playlists.
            </p>

            <div className="flex items-center gap-3">
              <ul className="flex -space-x-2" aria-label="People waiting">
                {summary.people.map((p) => (
                  <li key={p.id} title={p.displayName || p.username || 'Listener'}>
                    <Avatar person={p} />
                  </li>
                ))}
              </ul>
              {others > 0 && (
                <span className="text-secondary text-muted-foreground">
                  and {others} {others === 1 ? 'other' : 'others'}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-body text-muted-foreground" data-testid="make-public-text">
            Anyone will be able to see your reviews and playlists.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap">
          <button
            type="button"
            onClick={onConfirm}
            // Not before the count is known: the user must see what they're
            // agreeing to.
            disabled={summary === null}
            className="rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
          >
            {count > 0 ? 'Make public and accept all' : 'Make public'}
          </button>
          {count > 0 && (
            <button
              type="button"
              onClick={onReviewRequests}
              className="rounded-button bg-surface-2 px-4 py-2.5 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
            >
              Review requests first
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-button px-4 py-2.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground sm:mr-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Avatar({ person }: { person: PersonCardModel }) {
  const name = person.displayName || person.username || 'Listener'
  return person.avatarUrl ? (
    <img
      src={person.avatarUrl}
      alt={name}
      className="size-9 rounded-full object-cover ring-2 ring-surface"
    />
  ) : (
    <span
      aria-label={name}
      className="grid size-9 place-items-center rounded-full bg-surface-2 text-meta text-muted-foreground ring-2 ring-surface"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
