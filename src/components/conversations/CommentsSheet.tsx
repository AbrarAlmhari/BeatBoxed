import { useId } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Artwork } from '@/components/feed/Artwork'
import { CommentThread } from './CommentThread'
import { plainCommentText } from '@/lib/conversations'

/**
 * Comments on a phone: a bottom sheet with "Comments" and the count, the
 * song the review is about, Top/Newest, the thread, and the box pinned to
 * the bottom.
 */
export function CommentsSheet({
  open,
  onClose,
  reviewId,
  count,
  song,
  reviewText,
  reviewAuthor,
  me,
  highlightId,
  replyToId,
  focusComposer = false,
  draft,
  onDraftChange,
  onCount,
}: {
  open: boolean
  onClose: () => void
  reviewId: string
  count: number
  song: { id: string; title: string; artistName: string; coverUrl: string | null } | null
  /** A line of the review under the song, as in the mockup. */
  reviewText: string | null
  reviewAuthor: { name: string; avatarUrl: string | null }
  me: { name: string; avatarUrl: string | null }
  highlightId?: string | null
  replyToId?: string | null
  /** Opened by a tap: start typing straight away. */
  focusComposer?: boolean
  draft?: string
  onDraftChange?: (text: string) => void
  onCount: (n: number) => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="h-[92dvh] sm:h-[85vh]">
      <CommentThread
        reviewId={reviewId}
        reviewAuthor={reviewAuthor}
        me={me}
        inlineReplies={false}
        long={false}
        highlightId={highlightId}
        replyToId={replyToId}
        focusComposer={focusComposer}
        draft={draft}
        onDraftChange={onDraftChange}
        onCount={onCount}
      >
        {({ sort, list, composer }) => (
          <>
            <div className="flex items-center gap-3 px-4 pb-3 pt-3">
              <h2 id={titleId} className="flex items-center gap-2.5 text-section-title">
                Comments
                <span className="rounded-chip bg-primary/25 px-2.5 py-0.5 text-secondary font-semibold text-accent">
                  {count}
                </span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close comments"
                className="ml-auto grid size-11 place-items-center rounded-full bg-white/5 text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                <X className="size-5" strokeWidth={2} />
              </button>
            </div>
            {song && (
              <div className="mx-4 mb-3 flex items-center gap-3 rounded-inset bg-surface-2 p-2.5">
                <Artwork src={song.coverUrl} seed={song.id} className="size-10" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-secondary font-semibold">
                    {song.title} · {song.artistName}
                  </p>
                  {reviewText && (
                    <p dir="auto" className="truncate text-meta text-muted-foreground">
                      {plainCommentText(reviewText, [])}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="px-4 pb-2">{sort}</div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">{list}</div>
            <div className="border-t border-line bg-surface px-3 pb-3 pt-3">{composer}</div>
          </>
        )}
      </CommentThread>
    </Modal>
  )
}
