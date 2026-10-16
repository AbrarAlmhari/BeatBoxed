import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Info, Loader2, X } from 'lucide-react'
import { FormAlert } from '@/components/auth/FormAlert'
import { UsernameField } from '@/components/auth/UsernameField'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import {
  USERNAME_MESSAGES,
  normalizeUsername,
  usernameProblem,
  usernameSubmittable,
  useUsernameStatus,
} from '@/lib/username'
import { AVATAR_MAX_BYTES, AVATAR_TYPES, updateProfile, uploadAvatar } from '@/lib/catalog'
import { MUSIC_TAGS, TAGS_MAX, cleanCustomTag, sameTag, tagLabel } from '@/lib/tags'
import { cn } from '@/lib/cn'
import { BIO_MAX } from '@/lib/profile'
import type { ProfileDetail } from '@/lib/types'

const fieldClass =
  'w-full rounded-card border border-line-strong bg-surface px-4 py-3 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/20 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60'

/**
 * Edit profile (docs/mockups/onboarding): Cancel · Edit profile · Save at
 * the top, then photo, display name (required), username, bio, and "My
 * music tags": tap one of yours to remove it, tap "+ …" to add (up to 8).
 *
 * A username follows the rule (4–20 characters, letters, numbers, _ and .)
 * only when it's changed, so someone with an older, shorter username keeps
 * it and can edit everything else. Music tags are the user's own; the Stats
 * tab's genres, worked out from reviews, are separate.
 */
export function ProfileEditor({
  profile,
  onSaved,
  onCancel,
  focus = 'top',
}: {
  profile: ProfileDetail
  onSaved: (next: ProfileDetail) => void
  onCancel: () => void
  /** "tags" opens it scrolled to My music tags (the welcome card). */
  focus?: 'top' | 'tags'
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [username, setUsername] = useState(profile.username ?? '')
  const usernameStatus = useUsernameStatus(username, profile.username)
  const [bio, setBio] = useState((profile.bio ?? '').slice(0, BIO_MAX))
  const [tags, setTags] = useState<string[]>(profile.favoriteGenres.slice(0, TAGS_MAX))
  const [custom, setCustom] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tagsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focus !== 'tags') return
    tagsRef.current?.scrollIntoView({ block: 'start' })
    tagsRef.current?.focus({ preventScroll: true })
  }, [focus])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (!AVATAR_TYPES.includes(file.type)) return setError('Pick a PNG, JPEG, or WebP image.')
    if (file.size > AVATAR_MAX_BYTES) {
      return setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. Keep it under 2MB.`)
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

  const nextUsername = normalizeUsername(username)
  const usernameChanged = nextUsername !== normalizeUsername(profile.username ?? '')
  const canSave =
    !pending &&
    !uploading &&
    displayName.trim() !== '' &&
    (!usernameChanged || (!usernameProblem(nextUsername) && usernameSubmittable(usernameStatus)))

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!displayName.trim()) return setError('Add a display name.')
    if (usernameChanged) {
      const problem = usernameProblem(nextUsername)
      if (problem) return setError(`Username: ${USERNAME_MESSAGES[problem].toLowerCase()}.`)
      if (!usernameSubmittable(usernameStatus)) return setError('That username is taken. Pick another.')
    }

    setPending(true)
    try {
      await updateProfile(profile.id, {
        display_name: displayName.trim(),
        // Only sent when it changed, so an older short username is untouched.
        ...(usernameChanged ? { username: nextUsername } : {}),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        favorite_genres: tags,
      })
      onSaved({
        ...profile,
        displayName: displayName.trim(),
        username: usernameChanged ? nextUsername : profile.username,
        bio: bio.trim() || null,
        avatarUrl,
        favoriteGenres: tags,
      })
    } catch (err) {
      console.error('[beatboxed] profile save failed:', err)
      const code = (err as { code?: string } | null)?.code
      setError(
        code === '23505'
          ? 'That username is taken. Pick another.'
          : code === '23514'
            ? ((err as { message?: string }).message ?? "Couldn't save your profile. Try again.")
            : "Couldn't save your profile. Try again."
      )
      setPending(false)
    }
  }

  const shown = preview ?? avatarUrl
  const full = tags.length >= TAGS_MAX
  const more = MUSIC_TAGS.filter((t) => !tags.some((s) => sameTag(s, t)))
  const typed = cleanCustomTag(custom)

  function addTag(tag: string) {
    if (full || tags.some((s) => sameTag(s, tag))) return
    setTags([...tags, tagLabel(tag)])
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="animate-fade-in mx-auto flex w-full max-w-xl flex-col gap-6 motion-reduce:animate-none">
      <header className="glass-bar sticky top-0 z-10 -mx-4 flex min-h-14 items-center justify-between border-b border-line px-4 sm:-mx-6 sm:px-6 md:top-16">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="-ml-2 min-h-11 rounded-button px-2 text-body text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
        >
          Cancel
        </button>
        <h2 className="text-card-title">Edit profile</h2>
        <button
          type="submit"
          disabled={!canSave}
          className="-mr-2 flex min-h-11 items-center gap-1.5 rounded-button px-2 text-body font-semibold text-accent transition-colors duration-200 ease-soft hover:text-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2.5} aria-hidden />}
          Save
        </button>
      </header>

      {error && <FormAlert tone="error">{error}</FormAlert>}

      <div className="flex items-center gap-4">
        {shown ? (
          <img src={shown} alt="" className="size-20 rounded-full object-cover" />
        ) : (
          <span className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-primary/60 to-primary text-[30px] font-bold text-white">
            {(displayName || profile.username || '?').charAt(0).toUpperCase()}
          </span>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex min-h-11 items-center gap-2 rounded-chip border border-line-strong px-5 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-60"
        >
          {uploading && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />}
          {uploading ? 'Uploading…' : 'Change photo'}
        </button>
        <input ref={fileRef} type="file" accept={AVATAR_TYPES.join(',')} onChange={handleFile} className="sr-only" tabIndex={-1} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-medium text-muted-foreground">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
          required
          maxLength={50}
          dir="auto"
          aria-invalid={displayName.trim() === '' || undefined}
          className={fieldClass}
        />
        {displayName.trim() === '' && <span className="text-meta text-danger">A display name is required.</span>}
      </label>

      <UsernameField value={username} onChange={setUsername} status={usernameStatus} disabled={pending} />

      <label className="flex flex-col gap-1.5">
        <span className="text-secondary font-medium text-muted-foreground">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          disabled={pending}
          rows={3}
          dir="auto"
          placeholder="Tell people what you listen to."
          className={cn(fieldClass, 'resize-y')}
        />
        <span className="self-end text-meta text-muted-foreground tabular-nums">
          {bio.length} / {BIO_MAX}
        </span>
      </label>

      <section ref={tagsRef} tabIndex={-1} aria-labelledby="edit-tags-title" className="flex scroll-mt-24 flex-col gap-3 focus:outline-none">
        <div className="flex items-baseline justify-between">
          <h3 id="edit-tags-title" className="text-secondary font-medium text-muted-foreground">
            My music tags
          </h3>
          <span className="text-secondary text-muted-foreground tabular-nums">
            {tags.length} of {TAGS_MAX}
          </span>
        </div>
        {tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2.5" aria-label="Your music tags">
            {tags.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((s) => !sameTag(s, t)))}
                  aria-label={`Remove ${tagLabel(t)}`}
                  className="tap-44 relative flex items-center gap-2 rounded-chip border border-primary/70 bg-primary/15 py-1.5 pl-4 pr-3 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-primary/25"
                >
                  {tagLabel(t)}
                  <X className="size-4" strokeWidth={2.25} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-muted-foreground">No tags yet. Add a few below.</p>
        )}

        <h3 className="mt-2 text-secondary font-medium text-muted-foreground">Add more</h3>
        <div role="group" aria-label="Add a music tag" className="flex flex-wrap gap-2.5">
          {more.map((t) => (
            <Chip key={t} onClick={full ? undefined : () => addTag(t)}>
              {`+ ${t}`}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (typed) {
                  addTag(typed)
                  setCustom('')
                }
              }
            }}
            placeholder="Add your own tag"
            aria-label="Add your own tag"
            maxLength={40}
            disabled={full}
            className={cn(fieldClass, 'py-2.5')}
          />
          <button
            type="button"
            onClick={() => {
              if (typed) {
                addTag(typed)
                setCustom('')
              }
            }}
            disabled={!typed || full}
            className="min-h-11 shrink-0 rounded-button border border-line-strong px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/5 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {full && <p className="text-meta text-muted-foreground">That's {TAGS_MAX}, the most you can have. Remove one to add another.</p>}

        <Card padding="none" shadow={false} className="mt-1 flex gap-3 px-4 py-3.5">
          <Info className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
          <p className="text-secondary text-muted-foreground">
            Only you choose these. Your Stats tab still shows genres worked out from your reviews, separately.
          </p>
        </Card>
      </section>
    </form>
  )
}
