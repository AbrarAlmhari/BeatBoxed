import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Languages, Loader2, Sparkles, X } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { BeatieText, SLOW_TEXT, Thinking, useTakingAWhile } from './BeatieChat'
import {
  askBeatie,
  beatieErrorMessage,
  detectLyricsLanguage,
  languageName,
  useBeatieLanguage,
  type BeatieErrorCode,
} from '@/lib/beatie'
import { cn } from '@/lib/cn'

type Translation =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'on'; lines: string[] }
  | { status: 'error'; code: BeatieErrorCode }

/**
 * The Song page's lyrics, with two Beatie extras:
 *
 *   - Translate: the whole song into the user's Settings language, each
 *     translated line under its original. Offered only when the lyrics look
 *     like another language. Translations appear here and nowhere else.
 *   - Tap a line: "Explain this line", in a bottom sheet on phones and a
 *     popover beside the line on wider screens.
 */
export function LyricsView({ songId, lines }: { songId: string; lines: string[] }) {
  const language = useBeatieLanguage()
  const lyricsLanguage = detectLyricsLanguage(lines)
  const offerTranslation = lyricsLanguage !== null && lyricsLanguage !== language

  const [translation, setTranslation] = useState<Translation>({ status: 'off' })
  // Kept after "Show original only", so switching back costs nothing.
  const translated = useRef<{ language: string; lines: string[] } | null>(null)
  const [openLine, setOpenLine] = useState<number | null>(null)

  useEffect(() => {
    setTranslation({ status: 'off' })
    translated.current = null
    setOpenLine(null)
  }, [songId])

  async function toggleTranslation() {
    if (translation.status === 'on') return setTranslation({ status: 'off' })
    if (translated.current?.language === language) {
      return setTranslation({ status: 'on', lines: translated.current.lines })
    }
    setTranslation({ status: 'loading' })
    const res = await askBeatie({ action: 'translate', songId })
    if (res.ok && res.lines && res.lines.length === lines.length) {
      translated.current = { language: res.language, lines: res.lines }
      setTranslation({ status: 'on', lines: res.lines })
    } else {
      setTranslation({ status: 'error', code: res.ok ? 'error' : res.code })
    }
  }

  const shown = translation.status === 'on' ? translation.lines : null
  const translatingSlowly = useTakingAWhile(translation.status === 'loading')

  return (
    <div className="flex flex-col gap-3">
      {offerTranslation && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => void toggleTranslation()}
            disabled={translation.status === 'loading'}
            aria-pressed={translation.status === 'on'}
            className="flex items-center gap-2 rounded-button border border-white/10 bg-surface-2 px-3.5 py-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10 disabled:opacity-60"
          >
            {translation.status === 'loading' ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Languages className="size-4 text-primary" strokeWidth={1.75} aria-hidden />
            )}
            {translation.status === 'on'
              ? 'Show original only'
              : translation.status === 'loading'
                ? 'Translating…'
                : `Translate to ${languageName(language)}`}
          </button>
          <Link
            to="/settings"
            className="text-meta text-muted-foreground underline-offset-4 transition-colors duration-200 ease-soft hover:text-foreground hover:underline"
          >
            Change language
          </Link>
          {translatingSlowly && (
            <p role="status" className="w-full text-secondary text-muted-foreground">
              {SLOW_TEXT}
            </p>
          )}
          {translation.status === 'error' && (
            <p role="alert" className="w-full text-secondary text-muted-foreground">
              {beatieErrorMessage(translation.code)}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-card bg-surface p-3 shadow-card sm:p-4">
        {shown && (
          <p className="flex items-center gap-1.5 px-2 pb-2 text-meta text-muted-foreground">
            <Sparkles className="size-3.5 text-accent" strokeWidth={2} aria-hidden />
            Translated by Beatie · may not be exact
          </p>
        )}
        <p className="px-2 pb-1 text-meta text-muted-foreground">
          Tap a line to have Beatie explain it.
        </p>
        <ol className="flex flex-col">
          {lines.map((line, i) => (
            <li key={i} className="relative">
              <button
                type="button"
                onClick={() => setOpenLine(openLine === i ? null : i)}
                aria-haspopup="dialog"
                aria-expanded={openLine === i}
                className={cn(
                  'w-full rounded-button px-2 py-1.5 text-start transition-colors duration-150 ease-soft hover:bg-white/[0.04]',
                  openLine === i && 'bg-primary/10'
                )}
              >
                <span dir="auto" className="block text-body">
                  {line}
                </span>
                {shown?.[i] && (
                  <span
                    dir="auto"
                    className="mt-0.5 block text-secondary text-muted-foreground"
                    data-testid="lyric-translation"
                  >
                    {shown[i]}
                  </span>
                )}
              </button>
              <LinePanel
                open={openLine === i}
                onClose={() => setOpenLine(null)}
                songId={songId}
                line={line}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/** One line, and Beatie's explanation of it once asked. */
function LinePanel({
  open,
  onClose,
  songId,
  line,
}: {
  open: boolean
  onClose: () => void
  songId: string
  line: string
}) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; text: string }
    | { status: 'error'; code: BeatieErrorCode }
  >({ status: 'idle' })

  async function explain() {
    setState({ status: 'loading' })
    const res = await askBeatie({ action: 'line', songId, line })
    if (res.ok && res.text) setState({ status: 'done', text: res.text })
    else setState({ status: 'error', code: res.ok ? 'error' : res.code })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Explain this line"
      // Beside the line rather than under the screen's right edge.
      className="sm:left-0 sm:right-auto sm:w-96 sm:max-h-[26rem] sm:p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <blockquote
            dir="auto"
            className="flex-1 border-s-2 border-primary/60 ps-3 text-body italic text-foreground"
          >
            {line}
          </blockquote>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-me-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        {state.status === 'idle' || state.status === 'error' ? (
          <>
            <button
              type="button"
              onClick={() => void explain()}
              className="flex w-fit items-center gap-2 rounded-button bg-primary px-3.5 py-2 text-button text-white transition-colors duration-200 ease-soft hover:bg-accent"
            >
              <Sparkles className="size-4" strokeWidth={2} aria-hidden />
              Explain this line
            </button>
            {state.status === 'error' && (
              <p role="alert" className="text-secondary text-muted-foreground">
                {beatieErrorMessage(state.code)}
              </p>
            )}
          </>
        ) : state.status === 'loading' ? (
          <Thinking />
        ) : (
          <div data-testid="line-explanation">
            <BeatieText text={state.text} />
          </div>
        )}
      </div>
    </Sheet>
  )
}
