import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Settings } from 'lucide-react'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { PageGlow } from '@/components/ui/PageGlow'
import { tagLabel } from '@/lib/tags'
import { ProfileMenu } from './ProfileMenu'
import type { ProfileList } from './ProfileListSheet'
import type { FollowState, ProfileDetail } from '@/lib/types'

/**
 * The top of the profile: a soft glow, the avatar with its gradient ring,
 * name and handle, the counts row, and the actions.
 *
 * Phones get their own top bar here (back, when there's somewhere to go
 * back to, and "⋯"); the app's usual top bar is hidden on profile pages
 * below md. Desktop keeps the app's top bar and puts "⋯" beside the name.
 */
export function ProfileHero({
  profile,
  isOwn,
  writtenCount,
  followState,
  onFollowChange,
  hideFollow = false,
  onOpenList,
  onShowReviews,
  onEdit,
  onEditTags,
}: {
  profile: ProfileDetail
  isOwn: boolean
  /** Written reviews; null where it can't be counted (a locked profile). */
  writtenCount: number | null
  followState: FollowState
  onFollowChange: (next: FollowState, previous: FollowState) => void
  /** A locked profile's lock card carries the follow button instead. */
  hideFollow?: boolean
  onOpenList: (list: ProfileList) => void
  /** Ratings and reviews switch to the Reviews tab, reviews to Written. */
  onShowReviews: (written: boolean) => void
  onEdit: () => void
  /** Your own profile with no tags: opens Edit profile at the tags. */
  onEditTags?: () => void
}) {
  const navigate = useNavigate()
  const name = profile.displayName || profile.username || 'Listener'
  // React Router keeps its own position in history; 0 means this page was
  // opened directly, so there's nothing in the app to go back to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0

  const actions = isOwn ? (
    <>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex min-h-11 items-center gap-2 rounded-button border border-line-strong bg-surface-2 px-4 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
      >
        <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
        Edit profile
      </button>
      <Link
        to="/settings"
        aria-label="Settings"
        title="Settings"
        className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
      >
        <Settings className="size-[18px]" strokeWidth={1.75} />
      </Link>
    </>
  ) : hideFollow ? null : (
    <UserFollowButton
      personId={profile.id}
      state={followState}
      isPrivate={profile.isPrivate}
      onChange={onFollowChange}
      size="lg"
    />
  )

  return (
    <header className="relative flex flex-col gap-4">
      {/* Fades out before the tabs so they sit on the plain background. */}
      <PageGlow strength="hero" />

      {/* Phones: back and "⋯". */}
      <div className="flex items-center justify-between md:hidden">
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
        <ProfileMenu profileId={profile.id} name={name} />
      </div>

      <div className="flex items-center gap-4 md:gap-5">
        <Avatar url={profile.avatarUrl} name={name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-3">
            <h1 dir="auto" className="min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight md:text-[26px]">
              {name}
            </h1>
            {/* Desktop: actions on the name's line, "⋯" at the far end. */}
            <div className="hidden items-center gap-2 md:flex">{actions}</div>
            <ProfileMenu profileId={profile.id} name={name} className="ml-auto hidden md:block" />
          </div>
          {profile.username && (
            <p className="truncate text-secondary text-muted-foreground">@{profile.username}</p>
          )}
        </div>
      </div>

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

      <CountsRow
        ratings={profile.reviewCount}
        written={writtenCount}
        followers={profile.followerCount}
        following={profile.followingCount}
        artists={profile.artistCount}
        onShowReviews={onShowReviews}
        onOpenList={onOpenList}
      />

      {/* Phones: actions under the counts. */}
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
 * "128 ratings · 34 reviews · 86 followers · 71 following · 6 artists".
 * Wraps rather than scrolling sideways. Each count is a 44px target.
 */
function CountsRow({
  ratings,
  written,
  followers,
  following,
  artists,
  onShowReviews,
  onOpenList,
}: {
  ratings: number
  written: number | null
  followers: number
  following: number
  artists: number
  onShowReviews: (written: boolean) => void
  onOpenList: (list: ProfileList) => void
}) {
  return (
    <ul className="-my-1 flex flex-wrap items-center gap-x-4" aria-label="Profile counts">
      <Count value={ratings} label={ratings === 1 ? 'rating' : 'ratings'} onClick={() => onShowReviews(false)} />
      {written !== null && (
        <Count value={written} label={written === 1 ? 'review' : 'reviews'} onClick={() => onShowReviews(true)} />
      )}
      <Count value={followers} label={followers === 1 ? 'follower' : 'followers'} onClick={() => onOpenList('followers')} />
      <Count value={following} label="following" onClick={() => onOpenList('following')} />
      <Count value={artists} label={artists === 1 ? 'artist' : 'artists'} onClick={() => onOpenList('artists')} />
    </ul>
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
        </span>
        {label}
      </button>
    </li>
  )
}
