import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, Heart, MoreHorizontal } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { CommentText } from './CommentText'
import { PersonAvatar } from './PersonAvatar'
import { commentAge, type ThreadComment } from '@/lib/conversations'
import { cn } from '@/lib/cn'

/**
 * One comment or reply: avatar, name (with "Author" on the review's
 * author), time, the words in a bubble that's only as wide as they are,
 * then Like and Reply. The bubble sits under the name whatever the
 * language, so Arabic never floats to the far side of the card.
 */
export function CommentItem({
  comment,
  reviewAuthor,
  long,
  reply = false,
  highlighted = false,
  isMine,
  onLike,
  onReply,
  onDelete,
  muted = false,
  onMute,
}: {
  comment: ThreadComment
  /** For "Loved by author": the review author's name and picture. */
  reviewAuthor: { name: string; avatarUrl: string | null }
  /** Desktop: "2 weeks ago" rather than "2w". */
  long: boolean
  reply?: boolean
  highlighted?: boolean
  isMine: boolean
  onLike: () => void
  onReply: () => void
  onDelete: () => void
  /** By someone you muted: folded until you choose to read it. */
  muted?: boolean
  /** Someone else's comment: "⋯" offers Mute. */
  onMute?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  const avatar = reply ? 'size-8 text-meta' : 'size-10 text-secondary'

  if (comment.deleted) {
    return (
      <div ref={ref} data-comment-id={comment.id} className="flex gap-3">
        <span aria-hidden className={cn('shrink-0 rounded-full border border-dashed border-line-strong', avatar)} />
        <p className="self-center rounded-[16px] border border-dashed border-line-strong px-3.5 py-2 text-secondary italic text-muted-foreground">
          Comment deleted
        </p>
      </div>
    )
  }

  const name = comment.author?.displayName || comment.author?.username || 'Someone'
  const handle = comment.author?.username ? `@${comment.author.username}` : name

  if (muted && !revealed) {
    return (
      <div ref={ref} data-comment-id={comment.id} data-muted className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn('grid shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground', avatar)}
        >
          <BellOff className="size-4" strokeWidth={1.75} />
        </span>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-secondary text-muted-foreground">
          {reply ? 'Reply' : 'Comment'} from someone you muted ·
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="min-h-11 rounded-button px-1 font-semibold text-accent transition-colors duration-200 ease-soft hover:text-foreground"
          >
            Show
          </button>
        </p>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-comment-id={comment.id}
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex gap-3 rounded-card transition-colors duration-700 ease-soft',
        highlighted && '-m-2 bg-primary/10 p-2 ring-1 ring-primary/50'
      )}
    >
      <Link to={`/profile/${comment.userId}`} className="shrink-0" aria-hidden tabIndex={-1}>
        <PersonAvatar name={name} url={comment.author?.avatarUrl} className={avatar} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to={`/profile/${comment.userId}`}
            dir="auto"
            className="text-card-title transition-colors duration-200 ease-soft hover:text-accent"
          >
            {name}
          </Link>
          {comment.isAuthor && (
            <span className="rounded-md bg-primary/25 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent">
              Author
            </span>
          )}
          <span className="text-meta text-muted-foreground">
            {commentAge(comment.createdAt, long)}
            {comment.edited && ' · edited'}
          </span>
        </p>

        <div
          className={cn(
            'max-w-full rounded-[18px] px-3.5 py-2 text-body',
            comment.isAuthor ? 'bg-primary/20 text-foreground' : 'bg-surface-2 text-foreground'
          )}
        >
          <CommentText body={comment.body} mentions={comment.mentions} />
        </div>

        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onLike}
            aria-pressed={comment.likedByMe}
            aria-label={`${comment.likedByMe ? 'Unlike' : 'Like'} ${name}'s ${reply ? 'reply' : 'comment'}`}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-chip px-2.5 text-secondary font-semibold transition-colors duration-200 ease-soft',
              comment.likedByMe ? 'bg-like/15 text-like' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Heart className={cn('size-4', comment.likedByMe && 'fill-like')} strokeWidth={1.75} />
            {comment.likeCount > 0 && <span>{comment.likeCount}</span>}
          </button>
          <button
            type="button"
            onClick={onReply}
            className="min-h-11 rounded-button px-2.5 text-secondary font-semibold text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            Reply
          </button>
          {comment.authorLiked && (
            <span className="flex items-center gap-1.5 rounded-chip bg-like/10 py-1 pl-1 pr-2.5 text-meta font-semibold text-like">
              <PersonAvatar name={reviewAuthor.name} url={reviewAuthor.avatarUrl} className="size-5 text-[10px]" />
              Loved by author
            </span>
          )}
          {muted && revealed && (
            <button
              type="button"
              onClick={() => setRevealed(false)}
              className="min-h-11 rounded-button px-2.5 text-secondary text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
            >
              Hide again
            </button>
          )}
          {onMute && !isMine && (
            <span className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={`More options for ${name}'s ${reply ? 'reply' : 'comment'}`}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
              <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Comment options" className="sm:w-56">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onMute()
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body hover:bg-white/5"
                >
                  <BellOff className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  Mute {handle}
                </button>
              </Sheet>
            </span>
          )}
          {isMine &&
            (confirming ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false)
                    onDelete()
                  }}
                  className="min-h-11 rounded-button px-2.5 text-secondary font-semibold text-danger"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-11 rounded-button px-2.5 text-secondary text-muted-foreground hover:text-foreground"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label={`Delete your ${reply ? 'reply' : 'comment'}`}
                className="min-h-11 rounded-button px-2.5 text-secondary text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger"
              >
                Delete
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
