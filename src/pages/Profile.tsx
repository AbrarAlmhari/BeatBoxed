import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disc3, LogOut, Pencil, UserX } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { StarRating } from '@/components/ui/StarRating'
import { FollowButton } from '@/components/ui/FollowButton'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { tintFor } from '@/components/explore/tint'
import { useAuth } from '@/lib/auth'
import {
  getFollowedArtists,
  getGenres,
  getProfileDetail,
  getReviewsByUser,
} from '@/lib/catalog'
import type { ArtistCardModel, ProfileDetail, ReviewWithSong } from '@/lib/types'

type Tab = 'reviews' | 'playlists' | 'artists'

const TABS: { id: Tab; label: string }[] = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
]

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export default function Profile() {
  const { userId } = useParams()
  const { user, signOut } = useAuth()

  // /profile is your own; /profile/:userId is someone else's.
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [profile, setProfile] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<Tab>('reviews')

  const [reviews, setReviews] = useState<ReviewWithSong[] | null>(null)
  const [artists, setArtists] = useState<ArtistCardModel[] | null>(null)
  const [genres, setGenres] = useState<string[]>([])

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setReviews(null)
    setArtists(null)
    setEditing(false)

    getProfileDetail(targetId)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((err) => console.error('[beatboxed] profile lookup failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetId])

  useEffect(() => {
    if (tab !== 'reviews' || !profile || reviews) return
    getReviewsByUser(profile.id)
      .then(setReviews)
      .catch((err) => {
        console.error('[beatboxed] user reviews failed:', err)
        setReviews([])
      })
  }, [tab, profile, reviews])

  useEffect(() => {
    if (tab !== 'artists' || !profile || artists) return
    getFollowedArtists(profile.id)
      .then(setArtists)
      .catch((err) => {
        console.error('[beatboxed] followed artists failed:', err)
        setArtists([])
      })
  }, [tab, profile, artists])

  useEffect(() => {
    if (!editing) return
    getGenres()
      .then(setGenres)
      .catch((err) => console.warn('[beatboxed] genre list failed:', err))
  }, [editing])

  const handleSaved = useCallback((next: ProfileDetail) => {
    setProfile(next)
    setEditing(false)
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <div className="flex items-center gap-4">
          <div className="size-24 animate-pulse rounded-full bg-surface-2" />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-40 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-16 text-center">
        <UserX className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="text-card-title">Profile not found</p>
        <p className="max-w-sm text-body text-muted-foreground">
          This account doesn't exist, or the link is wrong.
        </p>
      </div>
    )
  }

  const name = profile.displayName || profile.username || 'Listener'

  if (editing) {
    return (
      <div className="pt-2">
        <ProfileEditor
          profile={profile}
          genres={genres}
          onSaved={handleSaved}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 pt-2">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="size-24 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-24 shrink-0 place-items-center rounded-full bg-surface-2 text-page-title text-muted-foreground">
              {name.charAt(0).toUpperCase()}
            </span>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <h1 dir="auto" className="text-page-title">
                {name}
              </h1>
              {isOwn && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-button bg-surface-2 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  Edit profile
                </button>
              )}
            </div>

            {profile.username && (
              <p className="text-secondary text-muted-foreground">
                @{profile.username}
              </p>
            )}

            {profile.bio && (
              <p dir="auto" className="max-w-prose text-body text-muted-foreground">
                {profile.bio}
              </p>
            )}

            {profile.favoriteGenres.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                {profile.favoriteGenres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full bg-surface-2 px-3 py-1 text-meta capitalize text-muted-foreground"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* No followers/following: that's the friendships table, not built yet. */}
        <dl className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <div className="rounded-card bg-surface p-4 shadow-card">
            <dt className="text-meta text-muted-foreground">Reviews written</dt>
            <dd className="mt-1 text-section-title">{profile.reviewCount}</dd>
          </div>
          <div className="rounded-card bg-surface p-4 shadow-card">
            <dt className="text-meta text-muted-foreground">Artists followed</dt>
            <dd className="mt-1 text-section-title">{profile.followingCount}</dd>
          </div>
        </dl>
      </header>

      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        role="tablist"
      >
        {TABS.map((t) => (
          <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {tab === 'reviews' && (
        <section className="flex flex-col gap-3">
          {reviews === null ? (
            <div className="h-24 animate-pulse rounded-card bg-surface" />
          ) : reviews.length === 0 ? (
            <EmptyPanel
              title="No reviews yet"
              detail={
                isOwn
                  ? "Rate a song and it'll show up here."
                  : "This listener hasn't reviewed anything yet."
              }
            />
          ) : (
            reviews.map((r) => (
              <Link
                key={r.id}
                to={r.song ? `/song/${r.song.id}` : '#'}
                className="flex gap-3 rounded-card bg-surface p-4 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
              >
                <span className="size-14 shrink-0 overflow-hidden rounded-[10px]">
                  {r.song?.coverUrl ? (
                    <img
                      src={r.song.coverUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span
                      className="grid size-full place-items-center"
                      style={{
                        background: `linear-gradient(135deg,
                          color-mix(in oklab, var(--color-primary) ${20 + tintFor(r.id) * 50}%, var(--color-surface-2)),
                          color-mix(in oklab, var(--color-accent) ${12 + tintFor(r.id) * 38}%, var(--color-background)))`,
                      }}
                    >
                      <Disc3 className="size-5 text-white/70" strokeWidth={1.5} />
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span dir="auto" className="text-card-title">
                      {r.song?.title ?? 'Unknown song'}
                    </span>
                    <StarRating value={r.rating} size={13} />
                    <span className="text-meta text-muted-foreground">
                      {dateFmt.format(new Date(r.createdAt))}
                      {r.edited && ' · edited'}
                    </span>
                  </span>
                  <span dir="auto" className="text-secondary text-muted-foreground">
                    {r.song?.artistName}
                  </span>
                  {r.title && (
                    <span dir="auto" className="text-card-title">
                      {r.title}
                    </span>
                  )}
                  {r.body && (
                    <span dir="auto" className="text-body text-muted-foreground">
                      {r.body}
                    </span>
                  )}
                </span>
              </Link>
            ))
          )}
        </section>
      )}

      {tab === 'playlists' && (
        <EmptyPanel
          title="No playlists yet"
          detail="Playlists arrive with the Library feature."
        />
      )}

      {tab === 'artists' && (
        <section>
          {artists === null ? (
            <div className="h-24 animate-pulse rounded-card bg-surface" />
          ) : artists.length === 0 ? (
            <EmptyPanel
              title="No artists followed"
              detail={
                isOwn
                  ? 'Follow an artist from a song page or search.'
                  : "This listener isn't following anyone yet."
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {artists.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col items-center gap-3 rounded-card bg-surface p-4 text-center shadow-card"
                >
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt=""
                      loading="lazy"
                      className="size-20 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="size-20 rounded-full"
                      style={{
                        background: `linear-gradient(135deg,
                          color-mix(in oklab, var(--color-primary) ${20 + tintFor(a.id) * 50}%, var(--color-surface-2)),
                          color-mix(in oklab, var(--color-accent) ${12 + tintFor(a.id) * 38}%, var(--color-background)))`,
                      }}
                    />
                  )}
                  {/* Not a link: there's no artist page yet. */}
                  <span dir="auto" className="line-clamp-2 text-card-title">
                    {a.name}
                  </span>
                  {isOwn && (
                    <FollowButton
                      artistId={a.id}
                      following
                      size="sm"
                      onChange={(next) => {
                        if (!next) {
                          setArtists((prev) =>
                            (prev ?? []).filter((x) => x.id !== a.id)
                          )
                          setProfile((p) =>
                            p
                              ? { ...p, followingCount: Math.max(0, p.followingCount - 1) }
                              : p
                          )
                        }
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isOwn && (
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-fit items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/10 hover:text-foreground active:scale-[0.98]"
        >
          <LogOut className="size-[18px]" strokeWidth={1.75} />
          Log out
        </button>
      )}
    </div>
  )
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
      <p className="text-card-title">{title}</p>
      <p className="max-w-sm text-body text-muted-foreground">{detail}</p>
    </div>
  )
}
