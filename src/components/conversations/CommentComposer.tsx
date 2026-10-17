import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Loader2, X } from 'lucide-react'
import { PersonAvatar } from './PersonAvatar'
import { useMentions } from './useMentions'
import { cn } from '@/lib/cn'

const MAX = 500

/**
 * Where a comment or reply is written.
 *
 * bar: the rounded box with the send arrow, pinned under the thread (the
 *   phone sheet and the bottom of the desktop card), with "Replying to
 *   @name" above it when replying.
 * inline: the desktop reply box that opens under a comment, with
 *   Cancel and Reply.
 *
 * Enter sends and Shift+Enter starts a new line in both; Esc cancels a
 * reply. Typing "@" opens suggestions above the box.
 */
export function CommentComposer({
  reviewId,
  me,
  variant = 'bar',
  replyingTo = null,
  initialText = '',
  autoFocus = false,
  draft = '',
  onDraftChange,
  onCancelReply,
  onSubmit,
}: {
  reviewId: string
  me: { name: string; avatarUrl: string | null }
  variant?: 'bar' | 'inline'
  /** @username shown in "Replying to"; null for a new top-level comment. */
  replyingTo?: string | null
  /** "@name " when replying to a reply. */
  initialText?: string
  autoFocus?: boolean
  /**
   * A new comment written earlier and not sent (the sheet or thread was
   * closed). Restored when the box opens again; replies don't use it.
   */
  draft?: string
  /** Every change to a new comment, so the card can keep the draft. */
  onDraftChange?: (text: string) => void
  onCancelReply?: () => void
  /** Resolves true when it was posted, so the box can clear. */
  onSubmit: (text: string) => Promise<boolean>
}) {
  const [text, setTextState] = useState(initialText || (replyingTo ? '' : draft))
  const [sending, setSending] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // A new comment's text is also the card's draft.
  const setText = (next: string) => {
    setTextState(next)
    if (!replyingTo) onDraftChange?.(next)
  }
  const mentions = useMentions({ reviewId, value: text, setValue: setText, inputRef: ref })

  // A new reply target brings its own "@name "; leaving a reply goes back to
  // the draft. On first open the text is already right (useState above).
  const target = useRef(replyingTo)
  useEffect(() => {
    if (target.current !== replyingTo) {
      target.current = replyingTo
      setTextState(initialText || (replyingTo ? '' : draft))
    }
    if (autoFocus || initialText || replyingTo) {
      requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        // The bottom box takes the cursor without moving the page: opening
        // a long thread on desktop shouldn't jump past the comments (on a
        // phone it's pinned to the bottom of the sheet anyway). An inline
        // reply box sits right under its comment, so scrolling to it is fine.
        // Cursor at the end first: moving it inside a focused box makes
        // Chrome scroll to it, which preventScroll is there to avoid.
        el.setSelectionRange(el.value.length, el.value.length)
        el.focus({ preventScroll: variant === 'bar' })
      })
    }
    // Only when the target changes (and on open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyingTo, initialText])

  // Grow with the text, up to about five lines.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const ok = await onSubmit(body)
    setSending(false)
    if (ok) setText('')
  }

  const canSend = text.trim().length > 0 && !sending
  const placeholder = replyingTo ? `Reply to @${replyingTo}…` : 'Add a comment… type @ to mention'

  const textarea = (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      maxLength={MAX}
      dir="auto"
      placeholder={placeholder}
      aria-label={replyingTo ? `Reply to @${replyingTo}` : 'Add a comment'}
      onChange={(e) => {
        setText(e.target.value)
        mentions.track()
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (mentions.onKeyDown(e)) return
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          void send()
        } else if (e.key === 'Escape' && onCancelReply) {
          e.preventDefault()
          onCancelReply()
        }
      }}
      {...mentions.inputProps}
      className="max-h-[132px] min-h-6 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-body text-foreground outline-none placeholder:text-muted-foreground/80"
    />
  )

  if (variant === 'inline') {
    return (
      <form onSubmit={send} className="relative">
        {mentions.list && <div className="absolute inset-x-0 bottom-full z-20 mb-2">{mentions.list}</div>}
        <div className="flex flex-col gap-2 rounded-card border-2 border-primary/70 bg-surface-2 p-3 shadow-[0_0_0_4px_rgb(139_92_246/0.15)]">
          <div className="flex items-start gap-3">
            <PersonAvatar name={me.name} url={me.avatarUrl} className="mt-0.5 size-8 text-meta" />
            {textarea}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-meta text-muted-foreground">
              Enter to send · Shift + Enter for a new line · Esc to cancel
            </p>
            <button
              type="button"
              onClick={onCancelReply}
              className="min-h-10 rounded-button px-3 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSend}
              className="flex min-h-10 items-center gap-2 rounded-chip bg-primary px-5 text-button text-white transition-colors duration-200 ease-soft hover:bg-accent disabled:opacity-50"
            >
              {sending && <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />}
              Reply
            </button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={send} className="relative flex flex-col gap-2">
      {mentions.list && <div className="absolute inset-x-0 bottom-full z-20 mb-2">{mentions.list}</div>}
      {replyingTo && (
        <div className="flex items-center gap-2 px-1">
          <p className="min-w-0 flex-1 truncate text-secondary text-muted-foreground">
            Replying to <span className="font-semibold text-accent">@{replyingTo}</span>
          </p>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="grid size-10 place-items-center rounded-full bg-white/5 text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      )}
      <div
        className={cn(
          'flex items-end gap-3 rounded-[28px] border bg-surface-2 py-1.5 pl-1.5 pr-1.5 transition-colors duration-200 ease-soft',
          focused || replyingTo ? 'border-primary/70 shadow-[0_0_0_4px_rgb(139_92_246/0.15)]' : 'border-line-strong'
        )}
      >
        <PersonAvatar name={me.name} url={me.avatarUrl} className="size-9 text-secondary" />
        {textarea}
        <button
          type="submit"
          disabled={!canSend}
          aria-label={replyingTo ? 'Send reply' : 'Post comment'}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors duration-200 ease-soft hover:bg-accent disabled:bg-white/10 disabled:text-muted-foreground"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          ) : (
            <ArrowRight className="size-[18px]" strokeWidth={2.25} />
          )}
        </button>
      </div>
      {/* Always takes its space and only fades: if it came and went with
          focus, tapping anything else would shrink the page mid-tap and the
          tap could land on something else. */}
      <p
        aria-hidden={!focused}
        className={cn(
          'px-2 text-meta text-muted-foreground transition-opacity duration-200 ease-soft',
          focused ? 'opacity-100' : 'opacity-0'
        )}
      >
        Type @ and a name. People you mention get a notification.
      </p>
    </form>
  )
}
