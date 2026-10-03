import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil, Settings, UserX } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { PlaylistGrid, PlaylistGridSkeleton } from '@/components/playlist/PlaylistGrid'
import {
  getPlaylistCount,
  getUserPlaylists,
  type PlaylistSummary,
} from '@/lib/playlists'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { FollowedArtistsGrid } from '@/components/profile/FollowedArtistsGrid'
import { FriendsPanel } from '@/components/people/FriendsPanel'
import { ProfileReviewCard } from '@/components/profile/ProfileReviewCard'
import { FriendButton } from '@/components/people/FriendButton'
import { useAuth } from '@/lib/auth'
import {
  getFollowedArtists,
  getFriendStates,
  getGenres,
  getProfileDetail,
  getReviewsByUser,
} from '@/lib/catalog'
import type {
  ArtistCardModel,
  FriendState,
  ProfileDetail,
  ReviewWithSong,
} from '@/lib/types'

type Tab = 'reviews' | 'playlists' | 'artists' | 'friends'

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
]

/** Tabs preview; the full lists live on their own pages. */
const REVIEW_PREVIEW = 5
/** Two rows of the grid at the widest breakpoint. */
const PLAYLIST_PREVIEW = 6
const ARTIST_PREVIEW = 8

export default function Profile() {
  const { userId } = useParams()
  const { user } = useAuth()

  // /profile is your own; /profile/:userId is someone else's.
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [profile, setProfile] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<Tab>('reviews')

  const [reviews, setReviews] = useState<ReviewWithSong[] | null>(null)
  const [artists, setArtists] = useState<ArtistCardModel[] | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null)
  /**
   * Counted separately from the list: a private profile shows its numbers to
   * a non-friend even though RLS returns none of the rows.
   */
  const [playlistCount, setPlaylistCount] = useState(0)
  const [genres, setGenres] = useState<string[]>([])
  const [friendState, setFriendState] = useState<FriendState>('none')

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

  // Resolve the relationship on open, so the button is right even when the
  // request was sent from Explore rather than here.
  useEffect(() => {
    if (!user || !targetId || isOwn) return setFriendState('none')
    let cancelled = false
    getFriendStates(user.id, [targetId])
      .then((m) => {
        if (!cancelled) setFriendState(m.get(targetId) ?? 'none')
      })
      .catch((err) => console.warn('[beatboxed] friend state failed:', err))
    return () => {
      cancelled = true
    }
  }, [user, targetId, isOwn])

  useEffect(() => {
    if (tab !== 'reviews' || !profile || reviews) return
    getReviewsByUser(profile.id)
      .then(setReviews)
      .catch((err) => {
        console.error('[beatboxed] user reviews failed:', err)
        setReviews([])
      })
  }, [tab, profile, reviews])

  // Loaded for the stat as well as the tab, so the count is right before
  // anyone opens it.
  useEffect(() => {
    if (!profile) return
    let cancelled = false
    Promise.all([getUserPlaylists(profile.id), getPlaylistCount(profile.id)])
      .then(([p, count]) => {
        if (cancelled) return
        setPlaylists(p)
        setPlaylistCount(count)
      })
      .catch((err) => {
        console.error('[beatboxed] profile playlists failed:', err)
        if (!cancelled) setPlaylists([])
      })
    return () => {
      cancelled = true
    }
  }, [profile])

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
  // friendships is private, so managing them only makes sense on your own page.
  /**
   * A private account shows its header and counts to everyone but keeps its
   * reviews, playlists, artists and friends to accepted friends. RLS already
   * returns nothing for these viewers; this is so the page says why instead
   * of looking empty.
   */
  const locked = Boolean(profile?.isPrivate) && !isOwn && friendState !== 'friends'

  const tabs = isOwn
    ? [...BASE_TABS, { id: 'friends' as Tab, label: 'Friends' }]
    : BASE_TABS

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
              {isOwn ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-button bg-surface-2 px-3 py-1.5 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  Edit profile
                </button>
              ) : null}
              {isOwn ? (
                <Link
                  to="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
                >
                  <Settings className="size-[18px]" strokeWidth={1.75} />
                </Link>
              ) : (
                <FriendButton
                  personId={profile.id}
                  state={friendState}
                  onChange={(next) => {
                    setFriendState(next)
                    // Becoming or ceasing to be friends moves the count by one.
                    setProfile((p) =>
                      p
                        ? {
                            ...p,
                            friendCount:
                              next === 'friends'
                                ? p.friendCount + 1
                                : friendState === 'friends'
                                  ? Math.max(0, p.friendCount - 1)
                                  : p.friendCount,
                          }
                        : p
                    )
                  }}
                />
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

        {/* Each stat opens its full list, the way tapping Followers does. */}
        <dl className="grid grid-cols-2 gap-3 sm:max-w-md md:grid-cols-3">
          <StatLink
            to={`/profile/${profile.id}/reviews`}
            label="Reviews written"
            value={profile.reviewCount}
          />
          <StatLink
            to={`/profile/${profile.id}/artists`}
            label="Artists followed"
            value={profile.followingCount}
          />
          <StatLink
            to={`/profile/${profile.id}/friends`}
            label="Friends"
            value={profile.friendCount}
          />
          {/* Locked profiles still show the number, but there's nothing to
              open, so it isn't a link. */}
          {locked ? (
            <div className="rounded-card bg-surface p-4 shadow-card">
              <dt className="text-meta text-muted-foreground">Playlists</dt>
              <dd className="mt-1 text-section-title">{playlistCount}</dd>
            </div>
          ) : (
            <StatLink
              to={`/profile/${profile.id}/playlists`}
              label="Playlists"
              value={playlistCount}
            />
          )}
        </dl>
      </header>

      {locked ? (
        <div className="rounded-card bg-surface px-6 py-12 text-center">
          <p className="text-card-title">This account is private</p>
          <p className="mx-auto mt-2 max-w-sm text-body text-muted-foreground">
            This account is private. Add them as a friend to see their reviews
            and playlists.
          </p>
        </div>
      ) : (
        <>
      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        role="tablist"
      >
        {tabs.map((t) => (
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
            <>
              {reviews.slice(0, REVIEW_PREVIEW).map((r) => (
                <ProfileReviewCard key={r.id} review={r} />
              ))}
              {profile.reviewCount > REVIEW_PREVIEW && (
                <SeeAllLink
                  to={`/profile/${profile.id}/reviews`}
                  count={profile.reviewCount}
                />
              )}
            </>
          )}
        </section>
      )}

      {tab === 'playlists' && (
        <section className="flex flex-col gap-3">
          {playlists === null ? (
            <PlaylistGridSkeleton count={2} />
          ) : playlists.length === 0 ? (
            <EmptyPanel
              title="No playlists yet"
              detail={
                isOwn
                  ? 'Create one from your Library, then add songs from any song page.'
                  : "This listener hasn't made any playlists yet."
              }
            />
          ) : (
            <>
              <PlaylistGrid playlists={playlists.slice(0, PLAYLIST_PREVIEW)} />
              {playlistCount > PLAYLIST_PREVIEW && (
                <SeeAllLink
                  to={`/profile/${profile.id}/playlists`}
                  count={playlistCount}
                />
              )}
            </>
          )}
        </section>
      )}

      {tab === 'artists' && (
        <section className="flex flex-col gap-3">
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
            <>
              <FollowedArtistsGrid
                artists={artists.slice(0, ARTIST_PREVIEW)}
                showUnfollow={isOwn}
                onUnfollowed={(artistId) => {
                  setArtists((prev) => (prev ?? []).filter((x) => x.id !== artistId))
                  setProfile((p) =>
                    p ? { ...p, followingCount: Math.max(0, p.followingCount - 1) } : p
                  )
                }}
              />
              {profile.followingCount > ARTIST_PREVIEW && (
                <SeeAllLink
                  to={`/profile/${profile.id}/artists`}
                  count={profile.followingCount}
                />
              )}
            </>
          )}
        </section>
      )}

      {tab === 'friends' && isOwn && user && (
        <FriendsPanel
          viewerId={user.id}
          onCountChange={(n) =>
            setProfile((p) => (p && p.friendCount !== n ? { ...p, friendCount: n } : p))
          }
        />
      )}
        </>
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

function StatLink({
  to,
  label,
  value,
}: {
  to: string
  label: string
  value: number
}) {
  return (
    <Link
      to={to}
      className="rounded-card bg-surface p-4 shadow-card transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]"
    >
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-section-title">{value}</dd>
    </Link>
  )
}

function SeeAllLink({ to, count }: { to: string; count: number }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-center rounded-card bg-surface px-4 py-3 text-button text-muted-foreground shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2 hover:text-foreground"
    >
      See all ({count})
    </Link>
  )
}
