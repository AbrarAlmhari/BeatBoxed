import { useEffect, useRef, useState } from 'react'
import { Image, Upload, X } from 'lucide-react'
import { PlaylistCover } from './PlaylistCover'
import { checkCoverFile, COVER_TYPES } from '@/lib/image'

/**
 * Picks a cover image, the same way the profile editor picks an avatar: a
 * hidden file input behind a button, validation before anything is uploaded,
 * and a local preview so the choice is visible before saving.
 *
 * Nothing is uploaded here. The chosen file is handed back and the form
 * uploads it once the playlist exists, which is what makes the same control
 * work for creating (no id yet) and editing.
 */
export function CoverPicker({
  currentUrl,
  derivedCovers,
  seed,
  onPick,
  onRemove,
}: {
  currentUrl: string | null
  /** The artwork grid shown when there's no custom cover. */
  derivedCovers: string[]
  seed: string
  onPick: (file: File | null) => void
  onRemove: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Object URLs are a leak if they outlive the element showing them.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Let the same file be picked again after a failed attempt.
    e.target.value = ''
    if (!file) return

    const check = checkCoverFile(file)
    if (!check.ok) {
      setError(check.message)
      return
    }

    setError(null)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })
    onPick(file)
  }

  const shown = preview ?? currentUrl
  const hasCover = Boolean(shown)

  return (
    <div className="flex items-start gap-4">
      <div className="w-24 shrink-0">
        <PlaylistCover covers={derivedCovers} seed={seed} customUrl={shown} />
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          <Upload className="size-4" strokeWidth={1.75} aria-hidden />
          {hasCover ? 'Change cover' : 'Upload cover'}
        </button>

        {hasCover && (
          <button
            type="button"
            onClick={() => {
              setPreview((old) => {
                if (old) URL.revokeObjectURL(old)
                return null
              })
              setError(null)
              onPick(null)
              onRemove()
            }}
            className="flex items-center gap-1.5 rounded-button px-1 py-1 text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            Remove cover
          </button>
        )}

        <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <Image className="size-3.5" strokeWidth={1.75} aria-hidden />
          Square crop, up to 5MB.
        </span>

        {error && <span className="text-meta text-danger">{error}</span>}

        <input
          ref={fileRef}
          type="file"
          accept={COVER_TYPES.join(',')}
          onChange={choose}
          aria-label="Playlist cover image"
          className="sr-only"
        />
      </div>
    </div>
  )
}
