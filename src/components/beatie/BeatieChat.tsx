import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { BeatieImage, type BeatieMood } from './BeatieImage'
import {
  CHAT_HISTORY,
  QUESTION_MAX,
  askBeatie,
  beatieErrorMessage,
  type BeatieErrorCode,
  type BeatieMessage,
} from '@/lib/beatie'

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
 *
 * `onAnswered` tells the surrounding card or sheet that an answer arrived,
 * so its Beatie can switch to the happy face.
 */
export function BeatieChat({
  songId,
  onAnswered,
}: {
  songId: string
  onAnswered?: () => void
}) {
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
      onAnswered?.()
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
      onAnswered?.()
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
            <BeatieImage mood="mark" size={18} />
            {EXPLAIN_QUESTION}
          </button>
          {explanation.status === 'error' && <BeatieNotice code={explanation.code} />}
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
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <li
                  key={i}
                  className="max-w-[88%] self-end rounded-card bg-primary/15 px-3.5 py-2.5 text-foreground"
                >
                  <span className="sr-only">You:</span>
                  <BeatieText text={m.text} />
                </li>
              ) : (
                // Beatie's replies carry its mark, like an avatar in a chat.
                <li key={i} className="flex max-w-[92%] items-start gap-2 self-start">
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-primary/15">
                    <BeatieImage mood="mark" size={22} />
                  </span>
                  <div className="min-w-0 rounded-card bg-surface-2 px-3.5 py-2.5 text-foreground">
                    <span className="sr-only">Beatie:</span>
                    <BeatieText text={m.text} />
                  </div>
                </li>
              )
            )}
          </ol>
        )}
        {pending && <Thinking />}
        {chatError && <BeatieNotice code={chatError} />}
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

/** After this long, the loading text says it's still going. */
export const SLOW_AFTER_MS = 8000
export const SLOW_TEXT = 'Still thinking… long songs take a moment'

/** True once `active` has stayed true for SLOW_AFTER_MS. */
export function useTakingAWhile(active: boolean) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!active) return
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [active])
  return slow
}

/**
 * "Beatie is thinking…", with Beatie's thinking face bobbing gently; after a
 * few seconds it says it's still going, so a long song doesn't look stuck.
 * Only shown while a request is out, so it starts fresh with each one.
 */
export function Thinking() {
  const slow = useTakingAWhile(true)
  return (
    <div role="status" className="flex items-center gap-3 text-secondary text-muted-foreground">
      <BeatieImage mood="thinking" size={48} />
      {slow ? SLOW_TEXT : 'Beatie is thinking…'}
    </div>
  )
}

/**
 * A failure, in words and in Beatie's face: sleepy for "taking a break" and
 * the daily limit, sad for anything else. "Check back in a moment" isn't a
 * failure, so it keeps the normal face.
 */
export function BeatieNotice({ code }: { code: BeatieErrorCode }) {
  const mood: BeatieMood =
    code === 'busy' || code === 'global' || code === 'limit'
      ? 'sleepy'
      : code === 'pending'
        ? 'default'
        : 'sad'
  return (
    <div role="alert" className="flex items-center gap-3 text-secondary text-muted-foreground">
      <BeatieImage mood={mood} size={48} />
      <p>{beatieErrorMessage(code)}</p>
    </div>
  )
}

export function NoLyricsNote() {
  return (
    <div className="flex items-center gap-3 rounded-button bg-surface-2 px-3 py-2 text-meta text-muted-foreground">
      <BeatieImage mood="sad" size={48} />
      <p>No lyrics found for this song, so Beatie is going on the title, artist and album only.</p>
    </div>
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
