import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, MicVocal, Sparkles } from 'lucide-react'
import {
  CHAT_HISTORY,
  QUESTION_MAX,
  askBeatie,
  beatieErrorMessage,
  type BeatieErrorCode,
  type BeatieMessage,
} from '@/lib/beatie'
import { cn } from '@/lib/cn'

const EXPLAIN_QUESTION = "What's this song about?"

type Explanation =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string; hasLyrics: boolean }
  | { status: 'error'; code: BeatieErrorCode }

/**
 * Beatie for one song: "What's this song about?" and the Ask Beatie chat.
 *
 * The one chat component, used by the Song page's Beatie card and Home's Ask
 * Beatie sheet, so both behave the same. The conversation lives only here, in
 * memory: leaving the song ends it, and nothing is saved.
 */
export function BeatieChat({ songId }: { songId: string }) {
  const inputId = useId()
  const [explanation, setExplanation] = useState<Explanation>({ status: 'idle' })
  const [messages, setMessages] = useState<BeatieMessage[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [chatError, setChatError] = useState<BeatieErrorCode | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // A different song is a different conversation.
  useEffect(() => {
    setExplanation({ status: 'idle' })
    setMessages([])
    setQuestion('')
    setChatError(null)
  }, [songId])

  useEffect(() => {
    if (messages.length || pending) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, pending])

  async function explain() {
    setExplanation({ status: 'loading' })
    const res = await askBeatie({ action: 'explain', songId })
    if (res.ok && res.text) {
      setExplanation({ status: 'done', text: res.text, hasLyrics: res.hasLyrics })
    } else {
      setExplanation({ status: 'error', code: res.ok ? 'error' : res.code })
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = question.trim()
    if (!text || pending) return

    const asked: BeatieMessage = { role: 'user', text }
    const conversation = [...messages, asked]
    // The explanation is part of what the user is replying to, so it rides
    // along as the opening exchange. Only the most recent messages are sent.
    const context: BeatieMessage[] =
      explanation.status === 'done'
        ? [
            { role: 'user', text: EXPLAIN_QUESTION },
            { role: 'assistant', text: explanation.text },
            ...conversation,
          ]
        : conversation

    setMessages(conversation)
    setQuestion('')
    setChatError(null)
    setPending(true)
    const res = await askBeatie({
      action: 'chat',
      songId,
      messages: context.slice(-CHAT_HISTORY),
    })
    setPending(false)
    if (res.ok && res.text) {
      setMessages([...conversation, { role: 'assistant', text: res.text }])
    } else {
      // Put the question back so nothing typed is lost.
      setMessages(messages)
      setQuestion(text)
      setChatError(res.ok ? 'error' : res.code)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {explanation.status === 'idle' || explanation.status === 'error' ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void explain()}
            className="flex w-fit items-center gap-2 rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98]"
          >
            <Sparkles className="size-4" strokeWidth={2} aria-hidden />
            {EXPLAIN_QUESTION}
          </button>
          {explanation.status === 'error' && (
            <p role="alert" className="text-secondary text-muted-foreground">
              {beatieErrorMessage(explanation.code)}
            </p>
          )}
        </div>
      ) : explanation.status === 'loading' ? (
        <Thinking />
      ) : (
        <div className="flex flex-col gap-3" data-testid="beatie-explanation">
          {!explanation.hasLyrics && <NoLyricsNote />}
          <BeatieText text={explanation.text} />
        </div>
      )}

      {/* Ask Beatie */}
      <div className="flex flex-col gap-3 border-t border-white/5 pt-4">
        {messages.length > 0 && (
          <ol className="flex flex-col gap-2.5" aria-label="Conversation with Beatie">
            {messages.map((m, i) => (
              <li
                key={i}
                className={cn(
                  'max-w-[88%] rounded-card px-3.5 py-2.5',
                  m.role === 'user'
                    ? 'self-end bg-primary/15 text-foreground'
                    : 'self-start bg-surface-2 text-foreground'
                )}
              >
                <span className="sr-only">{m.role === 'user' ? 'You:' : 'Beatie:'}</span>
                <BeatieText text={m.text} />
              </li>
            ))}
          </ol>
        )}
        {pending && <Thinking />}
        {chatError && (
          <p role="alert" className="text-secondary text-muted-foreground">
            {beatieErrorMessage(chatError)}
          </p>
        )}
        <div ref={endRef} />

        <form onSubmit={(e) => void send(e)} className="flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Ask Beatie about this song
          </label>
          <input
            id={inputId}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={QUESTION_MAX}
            disabled={pending}
            dir="auto"
            placeholder="Ask Beatie about this song…"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-button border border-white/10 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 focus:border-primary/70 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || question.trim() === ''}
            aria-label="Ask Beatie"
            className="grid size-11 shrink-0 place-items-center rounded-button bg-primary text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          >
            <ArrowUp className="size-5" strokeWidth={2.25} />
          </button>
        </form>
        {question.length > QUESTION_MAX - 100 && (
          <p className="-mt-1 text-meta text-muted-foreground">
            {question.length} / {QUESTION_MAX}
          </p>
        )}
      </div>
    </div>
  )
}

/** "Beatie is thinking…", with three softly pulsing dots. */
export function Thinking() {
  return (
    <div role="status" className="flex items-center gap-2.5 text-secondary text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse rounded-full bg-accent"
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </span>
      Beatie is thinking…
    </div>
  )
}

export function NoLyricsNote() {
  return (
    <p className="flex items-start gap-2 rounded-button bg-surface-2 px-3 py-2 text-meta text-muted-foreground">
      <MicVocal className="mt-px size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      No lyrics found for this song, so Beatie is going on the title, artist and album only.
    </p>
  )
}

/**
 * Beatie's answer as paragraphs. It's asked for plain prose, but models like
 * Markdown, so **bold** markers are taken off rather than shown.
 */
export function BeatieText({ text }: { text: string }) {
  const paragraphs = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return (
    <div className="flex flex-col gap-2.5">
      {paragraphs.map((p, i) => (
        <p key={i} dir="auto" className="whitespace-pre-line text-body">
          {p}
        </p>
      ))}
    </div>
  )
}
