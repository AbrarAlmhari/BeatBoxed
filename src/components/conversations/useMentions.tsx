import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { getMentionSuggestions, type MentionReason, type MentionSuggestion } from '@/lib/conversations'
import { PersonAvatar } from './PersonAvatar'
import { cn } from '@/lib/cn'

const REASON_LABEL: Record<Exclude<MentionReason, null>, string> = {
  thread: 'In this thread',
  following: 'You follow',
  follower: 'Follows you',
}

/** "@tr" right before the caret, not part of an email address. */
function activeQuery(text: string, caret: number) {
  const before = text.slice(0, caret)
  const m = before.match(/(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]*)$/)
  if (!m) return null
  return { query: m[2], start: caret - m[2].length - 1 }
}

/**
 * The "@" part of a comment box: works out whether the caret is in a
 * mention, fetches suggestions (who appears and in what order is decided by
 * mention_suggestions() in the database), and handles arrows, Enter, Tab,
 * Escape and taps.
 *
 * Picking is a convenience: a name typed in full becomes a mention when the
 * comment is saved either way.
 */
export function useMentions({
  reviewId,
  value,
  setValue,
  inputRef,
}: {
  reviewId: string
  value: string
  setValue: (v: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [results, setResults] = useState<{ query: string; people: MentionSuggestion[] } | null>(null)
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  const found = activeQuery(value, caret)
  const open = found !== null && dismissed !== found.start

  useEffect(() => {
    if (!open || !found) return
    const n = ++seq.current
    const t = setTimeout(() => {
      getMentionSuggestions(reviewId, found.query)
        .then((people) => {
          if (n !== seq.current) return
          setResults({ query: found.query, people })
          setActive(0)
        })
        .catch((err) => console.warn('[beatboxed] mention suggestions failed:', err))
    }, 150)
    return () => clearTimeout(t)
    // found is derived from value and caret, which are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, found?.query, found?.start, reviewId])

  const people = open && results ? results.people : []
  const showList = open && results !== null

  function pick(person: MentionSuggestion) {
    if (!found || !person.username) return
    const insert = `@${person.username} `
    const next = value.slice(0, found.start) + insert + value.slice(caret)
    setValue(next)
    const at = found.start + insert.length
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  /** Returns true when the key was for the list, so the box shouldn't act on it. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!showList) return false
    if (e.key === 'ArrowDown' && people.length) {
      e.preventDefault()
      setActive((i) => (i + 1) % people.length)
      return true
    }
    if (e.key === 'ArrowUp' && people.length) {
      e.preventDefault()
      setActive((i) => (i - 1 + people.length) % people.length)
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && people[active]) {
      e.preventDefault()
      pick(people[active])
      return true
    }
    if (e.key === 'Escape' && found) {
      e.preventDefault()
      setDismissed(found.start)
      return true
    }
    return false
  }

  const track = () => setCaret(inputRef.current?.selectionStart ?? value.length)

  const inputProps = {
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': showList,
    'aria-controls': showList ? listId : undefined,
    'aria-activedescendant': showList && people[active] ? `${listId}-${people[active].id}` : undefined,
    onSelect: track,
    onKeyUp: track,
    onClick: track,
  }

  const list = showList ? (
    <div className="animate-fade-in rounded-card border border-line-strong bg-surface-2 p-2 shadow-raised motion-reduce:animate-none">
      <p className="px-2 pb-1.5 pt-1 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
        Mention someone
      </p>
      {people.length === 0 ? (
        <p role="status" className="px-2 pb-2 text-secondary text-muted-foreground">
          No one matches <span className="text-foreground">@{results?.query}</span>. Keep typing, or
          send it as plain text.
        </p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Mention someone" className="flex flex-col gap-0.5">
          {people.map((p, i) => {
            const name = p.displayName || p.username || 'Someone'
            return (
              <li
                key={p.id}
                id={`${listId}-${p.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  // Keep focus in the box.
                  e.preventDefault()
                  pick(p)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-3 rounded-inset px-2 py-1.5 transition-colors duration-150 ease-soft',
                  i === active ? 'bg-primary/20' : 'hover:bg-white/5'
                )}
              >
                <PersonAvatar name={name} url={p.avatarUrl} className="size-9 text-secondary" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="truncate text-card-title">
                    {name}
                  </span>
                  <span className="truncate text-meta text-muted-foreground">@{p.username}</span>
                </span>
                {p.reason && (
                  <span className="shrink-0 rounded-chip bg-primary/20 px-2.5 py-1 text-meta font-semibold text-accent">
                    {REASON_LABEL[p.reason]}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  ) : null

  return { inputProps, onKeyDown, list, track }
}
