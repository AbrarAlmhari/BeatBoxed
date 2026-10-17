import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { SongPicker } from '@/components/feed/SongPicker'
import { Artwork } from '@/components/feed/Artwork'
import { BeatieChat } from './BeatieChat'
import { BeatieImage } from './BeatieImage'
import type { SongCardModel } from '@/lib/types'

/**
 * Home's Ask Beatie: pick a song, then talk about it.
 *
 * Step 1 is the review composer's song picker; step 2 is the same BeatieChat
 * the Song page uses — same requests, same limits, same cached explanation.
 * A bottom sheet on phones and a centred dialog on wider screens, like the
 * composer: a search list and a conversation don't fit in a small popover.
 */
export function AskBeatieSheet({
  open,
  onClose,
  initialSong,
}: {
  open: boolean
  onClose: () => void
  /** Open straight on this song (the check-in's "Ask me about it"). */
  initialSong?: SongCardModel
}) {
  const titleId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [query, setQuery] = useState('')
  const [song, setSong] = useState<SongCardModel | null>(null)
  // Beatie's face in the header: normal, then happy once an answer arrives.
  const [answered, setAnswered] = useState(false)

  // Each opening starts at the picker; the conversation isn't kept.
  useEffect(() => {
    if (!open) return
    setStep(initialSong ? 2 : 1)
    setQuery('')
    setSong(initialSong ?? null)
    setAnswered(false)
    // initialSong is read when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && step === 1) searchRef.current?.focus()
  }, [open, step])

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      initialFocus={searchRef}
      className="h-[92dvh] sm:h-auto sm:min-h-[560px]"
    >
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-3 sm:pt-5">
        {step === 2 && (
          <button
            type="button"
            onClick={() => setStep(1)}
            aria-label="Pick another song"
            className="-ml-3 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
        )}
        <BeatieImage mood={answered ? 'happy' : 'default'} size={48} />
        <h2 id={titleId} className="flex-1 text-section-title">
          Ask Beatie
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-3 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {step === 1 || !song ? (
          <SongPicker
            query={query}
            onQueryChange={setQuery}
            inputRef={searchRef}
            label="Which song do you want to talk about?"
            onPick={(picked) => {
              setSong(picked)
              setAnswered(false)
              setStep(2)
            }}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-card bg-surface-2 p-3">
              <Artwork src={song.coverUrl} seed={song.id} className="size-14" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span dir="auto" className="truncate text-card-title">
                  {song.title}
                </span>
                <span dir="auto" className="truncate text-secondary text-muted-foreground">
                  {song.artistName}
                </span>
              </div>
              <Link
                to={`/song/${song.id}`}
                onClick={onClose}
                className="min-h-11 shrink-0 rounded-button px-2 text-meta text-accent transition-colors duration-200 ease-soft hover:text-foreground"
              >
                Open song page
              </Link>
            </div>
            <BeatieChat songId={song.id} onAnswered={() => setAnswered(true)} />
          </div>
        )}
      </div>
    </Modal>
  )
}
