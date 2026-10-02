import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CoverPicker } from './CoverPicker'

/**
 * Title and description, used for both creating and editing. Title is the
 * only required field — a playlist with no description is normal, and making
 * people write one would just produce empty-ish text.
 */
export type PlaylistFormFields = {
  title: string
  description: string
  /** A newly chosen cover, uploaded by the caller once the playlist exists. */
  coverFile: File | null
  /** The owner cleared the existing cover. */
  removeCover: boolean
}

export function PlaylistForm({
  initialTitle = '',
  initialDescription = '',
  initialCoverUrl = null,
  derivedCovers = [],
  coverSeed = 'new',
  showCover = true,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus = true,
}: {
  initialTitle?: string
  initialDescription?: string
  initialCoverUrl?: string | null
  derivedCovers?: string[]
  coverSeed?: string
  /** Off inside the add-to-playlist picker, where the sheet is too small. */
  showCover?: boolean
  submitLabel: string
  onSubmit: (fields: PlaylistFormFields) => Promise<void>
  onCancel: () => void
  autoFocus?: boolean
}) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [removeCover, setRemoveCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const field =
    'w-full rounded-button bg-surface-2 px-3 py-2 text-body text-foreground outline-none ring-1 ring-white/5 transition-shadow duration-200 ease-soft placeholder:text-muted-foreground focus:ring-primary/60'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!title.trim()) {
      setError('Give the playlist a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ title, description, coverFile, removeCover })
    } catch (err) {
      console.error('[beatboxed] playlist save failed:', err)
      setError("That didn't save. Try again.")
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {showCover && (
        <CoverPicker
          currentUrl={removeCover ? null : initialCoverUrl}
          derivedCovers={derivedCovers}
          seed={coverSeed}
          onPick={(file) => {
            setCoverFile(file)
            if (file) setRemoveCover(false)
          }}
          onRemove={() => setRemoveCover(true)}
        />
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Late Night"
          maxLength={80}
          autoFocus={autoFocus}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-muted-foreground">
          Description <span className="opacity-70">(optional)</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this one for?"
          rows={2}
          maxLength={300}
          className={`${field} resize-none`}
        />
      </label>

      {error && <p className="text-meta text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-button bg-primary px-3 py-1.5 text-button text-white transition-all duration-200 ease-soft hover:bg-primary/90 active:scale-[0.97] disabled:opacity-60"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-button px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
