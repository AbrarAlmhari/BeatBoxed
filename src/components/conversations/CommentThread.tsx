import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { CommentItem } from './CommentItem'
import { CommentComposer } from './CommentComposer'
import { MuteConfirm, type MuteTarget } from '@/components/mutes/MuteConfirm'
import { useMutedIds } from '@/lib/mutes'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import {
  deleteComment,
  getThread,
  postComment,
  replyPrefix,
  setCommentLike,
  type ThreadComment,
  type ThreadEntry,
  type ThreadSort,
} from '@/lib/conversations'

/** Replies shown under a comment before "View N more replies". */
const SHOWN_REPLIES = 2

export type ThreadParts = {
  sort: ReactNode
  list: ReactNode
  composer: ReactNode
}

/**
 * A review's whole conversation: Top/Newest, the comments with their
 * replies, and the box to write in. Laid out by the caller (the phone
 * sheet pins the box to the bottom; the desktop card stacks everything),
 * so the parts come back separately.
 *
 * Likes change on screen straight away and go back if saving fails. Posting
 * and deleting reload the thread, since the database decides where a reply
 * goes, which @names became mentions and whether a placeholder stays.
 */
export function CommentThread({
  reviewId,
  reviewAuthor,
  me,
  inlineReplies,
  long,
  highlightId = null,
  replyToId = null,
  focusComposer = false,
  draft = '',
  onDraftChange,
  onCount,
  children,
}: {
  reviewId: string
  reviewAuthor: { name: string; avatarUrl: string | null }
  me: { name: string; avatarUrl: string | null }
  /** Desktop: the reply box opens under the comment, not at the bottom. */
  inlineReplies: boolean
  /** Desktop's "2 weeks ago". */
  long: boolean
  /** From a notification: outline this comment and make sure it's shown. */
  highlightId?: string | null
  /** From a notification's Reply: open the box replying to this comment. */
  replyToId?: string | null
  /** Put the cursor in the bottom box on open. */
  focusComposer?: boolean
  /** The unsent new comment, kept by the card while the thread is closed. */
  draft?: string
  onDraftChange?: (text: string) => void
  /** The total, replies included, whenever it changes. */
  onCount?: (n: number) => void
  children: (parts: ThreadParts) => ReactNode
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [sort, setSort] = useState<ThreadSort>('top')
  const [entries, setEntries] = useState<ThreadEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [replyTarget, setReplyTarget] = useState<ThreadComment | null>(null)
  const [pendingReplyId, setPendingReplyId] = useState(replyToId)
  const mutedIds = useMutedIds(user?.id)
  const [muting, setMuting] = useState<MuteTarget | null>(null)

  // Only the newest load may change the list. An older one arriving late
  // (switching Top and Newest, posting while it's still loading) would
  // otherwise put back what was there before, a like made since included.
  const latest = useRef(0)

  const load = useCallback(
    async (s: ThreadSort) => {
      const n = ++latest.current
      try {
        const next = await getThread(reviewId, s)
        if (n !== latest.current) return null
        setEntries(next)
        setFailed(false)
        return next
      } catch (err) {
        if (n !== latest.current) return null
        console.error('[beatboxed] thread failed:', err)
        setFailed(true)
        setEntries((e) => e ?? [])
        return null
      }
    },
    [reviewId]
  )

  useEffect(() => {
    void load(sort)
    // Closing the thread mid-load: nothing that arrives afterwards counts.
    return () => {
      latest.current++
    }
  }, [load, sort])

  const total = useMemo(
    () =>
      (entries ?? []).reduce(
        (n, e) => n + (e.deleted ? 0 : 1) + e.replies.filter((r) => !r.deleted).length,
        0
      ),
    [entries]
  )
  useEffect(() => {
    if (entries) onCount?.(total)
    // onCount is a callback prop; the total is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, entries !== null])

  // A highlighted or replied-to reply that sits past the first two is shown.
  useEffect(() => {
    if (!entries) return
    const want = [highlightId, pendingReplyId].filter(Boolean) as string[]
    for (const id of want) {
      const owner = entries.find((e) => e.id === id || e.replies.some((r) => r.id === id))
      if (owner && owner.replies.findIndex((r) => r.id === id) >= SHOWN_REPLIES) {
        setExpanded((s) => new Set(s).add(owner.id))
      }
    }
    if (pendingReplyId) {
      const target =
        entries.find((e) => e.id === pendingReplyId) ??
        entries.flatMap((e) => e.replies).find((r) => r.id === pendingReplyId)
      if (target && !target.deleted) setReplyTarget(target)
      setPendingReplyId(null)
    }
  }, [entries, highlightId, pendingReplyId])

  function patchComment(id: string, change: (c: ThreadComment) => ThreadComment) {
    setEntries((list) =>
      (list ?? []).map((e) =>
        e.id === id
          ? { ...change(e), replies: e.replies }
          : { ...e, replies: e.replies.map((r) => (r.id === id ? change(r) : r)) }
      )
    )
  }

  async function like(c: ThreadComment) {
    if (!user) return
    const next = !c.likedByMe
    const flip = (x: ThreadComment): ThreadComment => ({
      ...x,
      likedByMe: !x.likedByMe,
      likeCount: x.likeCount + (x.likedByMe ? -1 : 1),
    })
    patchComment(c.id, flip)
    try {
      await setCommentLike(c.id, user.id, next)
    } catch (err) {
      console.error('[beatboxed] comment like failed:', err)
      patchComment(c.id, flip)
      toast.show({ message: "Couldn't save that like. Try again." })
    }
  }

  async function submit(text: string, target: ThreadComment | null) {
    if (!user) return false
    try {
      const id = await postComment(reviewId, user.id, text, target?.id ?? null)
      const next = await load(sort)
      if (target && next) {
        const top = target.parentId ?? target.id
        const owner = next.find((e) => e.id === top)
        // Keep the new reply in view.
        if (owner && owner.replies.findIndex((r) => r.id === id) >= SHOWN_REPLIES) {
          setExpanded((s) => new Set(s).add(top))
        }
      }
      if (target) setReplyTarget(null)
      return true
    } catch (err) {
      console.error('[beatboxed] comment failed:', err)
      toast.show({ message: "Couldn't post that. Try again." })
      return false
    }
  }

  async function remove(c: ThreadComment) {
    if (!user) return
    try {
      await deleteComment(c.id, user.id)
      if (replyTarget?.id === c.id) setReplyTarget(null)
      await load(sort)
    } catch (err) {
      console.error('[beatboxed] comment delete failed:', err)
      toast.show({ message: "Couldn't delete that. Try again." })
    }
  }

  function startReply(c: ThreadComment) {
    setReplyTarget(c)
  }

  const replyText = replyTarget?.parentId ? replyPrefix(replyTarget.author?.username) : ''

  const item = (c: ThreadComment, reply: boolean) => (
    <CommentItem
      comment={c}
      reviewAuthor={reviewAuthor}
      long={long}
      reply={reply}
      highlighted={c.id === highlightId}
      isMine={!!user && c.userId === user.id}
      onLike={() => void like(c)}
      onReply={() => startReply(c)}
      onDelete={() => void remove(c)}
      muted={!!c.userId && mutedIds.has(c.userId)}
      onMute={
        c.userId && c.userId !== user?.id
          ? () =>
              setMuting({
                id: c.userId!,
                username: c.author?.username ?? null,
                name: c.author?.displayName || c.author?.username || 'Someone',
                avatarUrl: c.author?.avatarUrl ?? null,
              })
          : undefined
      }
    />
  )

  const inlineBox = (c: ThreadComment) =>
    inlineReplies && replyTarget?.id === c.id ? (
      <CommentComposer
        key={`reply-${c.id}`}
        reviewId={reviewId}
        me={me}
        variant="inline"
        replyingTo={c.author?.username ?? null}
        initialText={replyText}
        autoFocus
        onCancelReply={() => setReplyTarget(null)}
        onSubmit={(text) => submit(text, c)}
      />
    ) : null

  const sortRow = (
    <div className="flex gap-2" role="group" aria-label="Sort comments">
      <Chip solid active={sort === 'top'} onClick={() => setSort('top')}>
        Top
      </Chip>
      <Chip solid active={sort === 'newest'} onClick={() => setSort('newest')}>
        Newest
      </Chip>
    </div>
  )

  const list =
    entries === null ? (
      <p role="status" className="flex items-center gap-2 py-4 text-secondary text-muted-foreground">
        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
        Loading comments…
      </p>
    ) : entries.length === 0 ? (
      <p className="py-4 text-secondary text-muted-foreground">
        {failed ? "Couldn't load comments." : 'No comments yet. Start the conversation.'}
      </p>
    ) : (
      <ul className="flex flex-col gap-5" aria-label="Comments">
        {entries.map((e) => {
          const open = expanded.has(e.id)
          const shown = open ? e.replies : e.replies.slice(0, SHOWN_REPLIES)
          const hidden = e.replies.length - shown.length
          return (
            <li key={e.id} className="flex flex-col gap-3">
              {item(e, false)}
              {inlineBox(e)}
              {e.replies.length > 0 && (
                <ul
                  className="ml-5 flex flex-col gap-4 border-l-2 border-primary/25 pl-5"
                  aria-label={`Replies to ${e.deleted ? 'a deleted comment' : e.author?.displayName || e.author?.username || 'a comment'}`}
                >
                  {shown.map((r) => (
                    <li key={r.id} className="flex flex-col gap-3">
                      {item(r, true)}
                      {inlineBox(r)}
                    </li>
                  ))}
                  {(hidden > 0 || (open && e.replies.length > SHOWN_REPLIES)) && (
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s)
                            if (open) n.delete(e.id)
                            else n.add(e.id)
                            return n
                          })
                        }
                        className="flex min-h-11 items-center gap-3 text-secondary font-semibold text-accent transition-colors duration-200 ease-soft hover:text-foreground"
                      >
                        <span aria-hidden className="h-0.5 w-8 rounded-full bg-primary/40" />
                        {hidden > 0
                          ? `View ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}`
                          : 'Hide replies'}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    )

  const composer = (
    <CommentComposer
      reviewId={reviewId}
      me={me}
      replyingTo={!inlineReplies && replyTarget ? (replyTarget.author?.username ?? null) : null}
      initialText={!inlineReplies ? replyText : ''}
      autoFocus={focusComposer}
      draft={draft}
      onDraftChange={onDraftChange}
      onCancelReply={() => setReplyTarget(null)}
      // On desktop the bottom box is always a new top-level comment.
      onSubmit={(text) => submit(text, inlineReplies ? null : replyTarget)}
    />
  )

  return (
    <>
      {children({ sort: sortRow, list, composer })}
      <MuteConfirm target={muting} onClose={() => setMuting(null)} />
    </>
  )
}
