import { useRef, useState, type FormEvent } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { FormAlert } from '@/components/auth/FormAlert'
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  updateProfile,
  uploadAvatar,
} from '@/lib/catalog'
import type { ProfileDetail } from '@/lib/types'

export function ProfileEditor({
  profile,
  genres,
  onSaved,
  onCancel,
}: {
  profile: ProfileDetail
  /** The catalog's genre vocabulary — same list Explore uses. */
  genres: string[]
  onSaved: (next: ProfileDetail) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [selected, setSelected] = useState<string[]>(profile.favoriteGenres)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function toggleGenre(g: string) {
    setSelected((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    )
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    if (!AVATAR_TYPES.includes(file.type)) {
      setError('Pick a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. Keep it under 2MB.`
      )
      return
    }

    // Show the local file immediately; swap to the stored URL once it lands.
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      setAvatarUrl(await uploadAvatar(profile.id, file))
    } catch (err) {
      console.error('[beatboxed] avatar upload failed:', err)
      setError("Couldn't upload that image. Try again.")
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await updateProfile(profile.id, {
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        favorite_genres: selected.length ? selected : null,
        avatar_url: avatarUrl,
      })
      onSaved({
        ...profile,
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        favoriteGenres: selected,
        avatarUrl,
      })
    } catch (err) {
      console.error('[beatboxed] profile save failed:', err)
      setError("Couldn't save your profile. Try again.")
      setPending(false)
    }
  }

  const shown = preview ?? avatarUrl

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-fade-in flex flex-col gap-5 rounded-card bg-surface p-5 shadow-card"
    >
      <h2 className="text-section-title">Edit profile</h2>
      {error && <FormAlert tone="error">{error}</FormAlert>}

      <div className="flex items-center gap-4">
        {shown ? (
          <img
            src={shown}
            alt=""
            className="size-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-full bg-surface-2 text-page-title text-muted-foreground">
            {(displayName || profile.username || '?').charAt(0).toUpperCase()}
          </span>
        )}

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-fit items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Upload className="size-4" strokeWidth={1.75} />
            )}
            {uploading ? 'Uploading…' : 'Change picture'}
          </button>
          <span className="text-meta text-muted-foreground">
            PNG, JPEG or WebP, up to 2MB.
          </span>
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            onChange={handleFile}
            className="sr-only"
          />
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-medium">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
          maxLength={50}
          dir="auto"
          className="w-full rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-medium">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={pending}
          rows={3}
          maxLength={300}
          dir="auto"
          placeholder="Tell people what you listen to."
          className="w-full resize-y rounded-button border border-white/5 bg-surface-2 px-3.5 py-2.5 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-secondary font-medium">Genre interests</span>
        {genres.length === 0 ? (
          <p className="text-secondary text-muted-foreground">
            No genres in the catalog yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <Chip
                key={g}
                active={selected.includes(g)}
                onClick={() => toggleGenre(g)}
              >
                <span className="capitalize">{g}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || uploading}
          className="flex items-center gap-2 rounded-button bg-primary px-4 py-2.5 text-button text-white transition-all duration-200 ease-soft hover:bg-accent active:scale-[0.98] disabled:opacity-60 disabled:hover:bg-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
          Save changes
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-button bg-surface-2 px-4 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/10 hover:text-foreground active:scale-[0.98] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
