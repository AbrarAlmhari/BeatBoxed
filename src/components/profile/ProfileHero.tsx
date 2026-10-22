import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Settings } from 'lucide-react'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { PageGlow } from '@/components/ui/PageGlow'
import { tagLabel } from '@/lib/tags'
import { ProfileMenu } from './ProfileMenu'
import { cn } from '@/lib/cn'
import { MuteBanner } from '@/components/mutes/MuteBanner'
import type { ProfileList } from './ProfileListSheet'
import type { ArtistCardModel, FollowState, ProfileDetail } from '@/lib/types'

/**
 * The top of the profile: a soft glow, the avatar with its gradient ring,
 * name, handle and "6 followers · 8 following", then bio, tags, "Listens
 * to", and the actions: Edit profile (or Follow) with a square "⋯" beside
 * it.
 *
 * Settings (your own profile) is the gear in the top-right corner. Phones
 * get their own top bar here (back, when there's somewhere to go back to,
 * and the gear); the app's usual top bar is hidden on profile pages below
 * md. Desktop keeps the app's top bar, puts the actions on the name's line
 * and the gear at its far end.
 */
export function ProfileHero({
  profile,
  isOwn,
  artists,
  followState,
  onFollowChange,
  hideFollow = false,
  onOpenList,
  onEdit,
  onEditTags,
}: {
  profile: ProfileDetail
  isOwn: boolean
  /** Up to 4 followed artists for "Listens to"; empty where they can't be seen. */
  artists: ArtistCardModel[]
  followState: FollowState
  onFollowChange: (next: FollowState, previous: FollowState) => void
  /** A locked profile's lock card carries the follow button instead. */
  hideFollow?: boolean
  onOpenList: (list: ProfileList) => void
  onEdit: () => void
  /** Your own profile with no tags: opens Edit profile at the tags. */
  onEditTags?: () => void
}) {
  const navigate = useNavigate()
  const name = profile.displayName || profile.username || 'Listener'
  const menuPerson = { id: profile.id, username: profile.username, name, avatarUrl: profile.avatarUrl }
  // React Router keeps its own position in history; 0 means this page was
  // opened directly, so there's nothing in the app to go back to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0

  const main = isOwn ? (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex min-h-11 items-center gap-2 rounded-button border border-line-strong bg-surface-2 px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
    >
      <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
      Edit profile
    </button>
  ) : hideFollow ? null : (
    <UserFollowButton
      personId={profile.id}
      state={followState}
      isPrivate={profile.isPrivate}
      onChange={onFollowChange}
      size="lg"
    />
  )
  // Edit profile (or Follow), then a square "⋯" of the same height.
  const actions = (
    <>
      {main}
      <ProfileMenu person={menuPerson} isOwn={isOwn} />
    </>
  )
  const gear = (
    <Link
      to="/settings"
      aria-label="Settings"
      title="Settings"
      className="grid size-11 shrink-0 place-items-center rounded-full bg-black/30 text-foreground backdrop-blur-md transition-colors duration-200 ease-soft hover:bg-black/45"
    >
      <Settings className="size-5" strokeWidth={1.75} />
    </Link>
  )

  return (
    <header className="relative flex flex-col gap-4">
      {/* Fades out before the tabs so they sit on the plain background. */}
      <PageGlow strength="hero" />

      {/* Phones: back, and the gear on your own profile. */}
      <div className="flex min-h-11 items-center justify-between md:hidden">
        {canGoBack ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="grid size-11 place-items-center rounded-full bg-black/30 text-foreground backdrop-blur-md transition-colors duration-200 ease-soft hover:bg-black/45"
          >
            <ArrowLeft className="size-5" strokeWidth={2} />
          </button>
        ) : (
          <span />
        )}
        {isOwn && gear}
      </div>

      <div className="flex items-center gap-4 md:gap-5">
        <Avatar url={profile.avatarUrl} name={name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-3">
            <h1 dir="auto" className="min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight md:text-[26px]">
              {name}
            </h1>
            {/* Desktop: actions on the name's line, the gear at the far end. */}
            <div className="hidden items-center gap-2 md:flex">{actions}</div>
            {isOwn && <div className="ml-auto hidden md:block">{gear}</div>}
          </div>
          {profile.username && (
            <p className="truncate text-secondary text-muted-foreground">@{profile.username}</p>
          )}
          <FollowCounts
            followers={profile.followerCount}
            following={profile.followingCount}
            onOpenList={onOpenList}
          />
        </div>
      </div>

      {!isOwn && (
        <MuteBanner personId={profile.id} handle={profile.username ? `@${profile.username}` : name} />
      )}

      {profile.bio && (
        <p dir="auto" className="line-clamp-2 max-w-prose text-body text-muted-foreground">
          {profile.bio}
        </p>
      )}

      {/* Only the tags they chose. Genres worked out from their reviews are
          on the Stats tab, not here. */}
      {profile.favoriteGenres.length > 0 ? (
        <ul aria-label="Music tags" className="flex flex-wrap gap-2">
          {profile.favoriteGenres.map((t) => (
            <li key={t}>
              <span className="inline-flex min-h-8 items-center rounded-chip bg-primary/20 px-3.5 text-button text-accent">
                {tagLabel(t)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        isOwn &&
        onEditTags && (
          <button
            type="button"
            onClick={onEditTags}
            className="-my-2 inline-flex min-h-11 w-fit items-center text-button text-accent transition-colors duration-200 ease-soft hover:text-foreground"
          >
            Add your music tags
          </button>
        )
      )}

      <ListensTo artists={artists} total={profile.artistCount} onOpen={() => onOpenList('artists')} />

      {/* Phones: actions at the end of the header. */}
      <div className="flex items-center gap-2 md:hidden">{actions}</div>
    </header>
  )
}

/** 72px (96px on desktop), in a 3px purple → pink → gold ring. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <span
      className="shrink-0 rounded-full p-[3px] size-[72px] md:size-24"
      style={{ background: 'var(--profile-ring)' }}
    >
      {url ? (
        <img src={url} alt={`${name}'s profile picture`} className="size-full rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center rounded-full bg-surface-2 text-[26px] font-bold text-foreground md:text-[34px]"
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/**
 * "6 followers · 8 following", under the handle. Each opens its own list;
 * each is a 44px target.
 */
function FollowCounts({
  followers,
  following,
  onOpenList,
}: {
  followers: number
  following: number
  onOpenList: (list: ProfileList) => void
}) {
  return (
    <ul className="-my-1.5 flex flex-wrap items-center gap-x-2" aria-label="Profile counts">
      <Count value={followers} label={followers === 1 ? 'follower' : 'followers'} onClick={() => onOpenList('followers')} />
      <li aria-hidden className="text-muted-foreground">
        ·
      </li>
      <Count value={following} label="following" onClick={() => onOpenList('following')} />
    </ul>
  )
}

/**
 * "Listens to J. Cole, Jack Harlow and 8 more", with up to 4 of their
 * pictures overlapping. Opens the Artists list. Hidden with no artists; on
 * a private profile you can't see, just the number.
 */
function ListensTo({
  artists,
  total,
  onOpen,
}: {
  artists: ArtistCardModel[]
  total: number
  onOpen: () => void
}) {
  if (total <= 0) return null
  const named = artists.slice(0, 2)
  const rest = total - named.length
  return (
    <button
      type="button"
      onClick={onOpen}
      data-listens-to
      className="-my-1 flex min-h-11 w-fit max-w-full items-center gap-2.5 rounded-button text-left text-secondary text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
    >
      {artists.length > 0 && (
        <span className="flex shrink-0" aria-hidden>
          {artists.slice(0, 4).map((a, i) =>
            a.imageUrl ? (
              <img
                key={a.id}
                src={a.imageUrl}
                alt=""
                className={cn('size-8 rounded-full object-cover ring-2 ring-background', i > 0 && '-ml-2.5')}
              />
            ) : (
              <span
                key={a.id}
                className={cn(
                  'grid size-8 place-items-center rounded-full bg-surface-2 text-meta font-bold text-foreground ring-2 ring-background',
                  i > 0 && '-ml-2.5'
                )}
              >
                {a.name.charAt(0).toUpperCase()}
              </span>
            )
          )}
        </span>
      )}
      <span className="min-w-0">
        Listens to{' '}
        {named.length === 0 ? (
          <b className="font-semibold text-foreground">
            {total} {total === 1 ? 'artist' : 'artists'}
          </b>
        ) : (
          <>
            {named.map((a, i) => (
              <span key={a.id}>
                {i > 0 && (rest > 0 ? ', ' : ' and ')}
                <b dir="auto" className="font-semibold text-foreground">
                  {a.name}
                </b>
              </span>
            ))}
            {rest > 0 && ` and ${rest} more`}
          </>
        )}
      </span>
    </button>
  )
}

function Count({ value, label, onClick }: { value: number; label: string; onClick: () => void }): ReactNode {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-button text-secondary text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
      >
        <span className="text-[15px] font-bold tabular-nums text-foreground">
          {value.toLocaleString()}
        </span>{' '}
        {label}
      </button>
    </li>
  )
}
