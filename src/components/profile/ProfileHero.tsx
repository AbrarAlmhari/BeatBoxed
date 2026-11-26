import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Settings } from 'lucide-react'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { PageGlow } from '@/components/ui/PageGlow'
import { tagLabel } from '@/lib/tags'
import { ProfileMenu } from './ProfileMenu'
import { cn } from '@/lib/cn'
import { useWideLayout } from '@/lib/conversations'
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
  showReviewCount = false,
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
  /** A locked profile has no tab bar to show its review count, so the header does. */
  showReviewCount?: boolean
  onOpenList: (list: ProfileList) => void
  onEdit: () => void
  /** Your own profile with no tags: opens Edit profile at the tags. */
  onEditTags?: () => void
}) {
  const navigate = useNavigate()
  const wide = useWideLayout()
  const name = profile.displayName || profile.username || 'Listener'
  const menuPerson = { id: profile.id, username: profile.username, name, avatarUrl: profile.avatarUrl }
  // React Router keeps its own position in history; 0 means this page was
  // opened directly, so there's nothing in the app to go back to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0

  const main = isOwn ? (
    <button
      type="button"
      onClick={onEdit}
      className="btn-secondary px-4 text-button transition-colors duration-200 ease-soft hover:bg-white/10 max-md:flex-1"
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
  // Phones: the "⋯" moves up beside the handle when it's someone else's
  // profile; your own keeps it next to Edit profile.
  const phoneActions = isOwn ? actions : main
  const gear = (
    <Link
      to="/settings"
      aria-label="Settings"
      title="Settings"
      className="tap-44 round-btn bg-white/[0.06] text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
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
            className="tap-44 round-btn bg-white/[0.06] text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
          >
            <ArrowLeft className="size-5 rtl:rotate-180" strokeWidth={2} />
          </button>
        ) : (
          <span className="w-10" />
        )}
        <p aria-hidden className="min-w-0 truncate px-2 text-[15px] font-semibold">
          {profile.username ? `@${profile.username}` : name}
        </p>
        {isOwn ? gear : <ProfileMenu person={menuPerson} isOwn={isOwn} />}
      </div>

      {/* Phones: the ringed picture with the three counts beside it. */}
      {!wide && (
      <>
      <div className="flex items-center gap-4 md:hidden">
        <Avatar url={profile.avatarUrl} name={name} />
        <ul aria-label="Profile counts" className="flex flex-1 justify-around text-center">
          {showReviewCount && (
            <li className="flex min-h-11 flex-1 flex-col items-center justify-center">
              <PhoneNum value={profile.reviewCount} />{' '}
              <PhoneLabel>{profile.reviewCount === 1 ? 'review' : 'reviews'}</PhoneLabel>
            </li>
          )}
          <li className="flex-1">
            <button type="button" onClick={() => onOpenList('followers')} className="flex min-h-11 w-full flex-col items-center justify-center">
              <PhoneNum value={profile.followerCount} />{' '}
              <PhoneLabel>{profile.followerCount === 1 ? 'follower' : 'followers'}</PhoneLabel>
            </button>
          </li>
          <li className="flex-1">
            <button type="button" onClick={() => onOpenList('following')} className="flex min-h-11 w-full flex-col items-center justify-center">
              <PhoneNum value={profile.followingCount} />{' '}
              <PhoneLabel>following</PhoneLabel>
            </button>
          </li>
        </ul>
      </div>
      <div className="-mt-1 flex min-w-0 flex-col md:hidden">
        <h1 dir="auto" className="truncate font-heading text-[18px] font-bold leading-tight">
          {name}
        </h1>
        {profile.username && <p className="truncate text-[13px] text-muted-foreground">@{profile.username}</p>}
      </div>
      </>
      )}

      {wide && (
      <div className="hidden items-center gap-4 md:flex md:gap-5">
        <Avatar url={profile.avatarUrl} name={name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-3">
            <h1 dir="auto" className="min-w-0 truncate text-[20px] font-bold leading-tight tracking-[-0.01em] md:text-[26px]">
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
            reviews={showReviewCount ? profile.reviewCount : undefined}
            followers={profile.followerCount}
            following={profile.followingCount}
            onOpenList={onOpenList}
          />
        </div>
      </div>
      )}

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
              <span className="inline-flex h-7 items-center rounded-chip border border-[#a78bfa]/45 bg-primary/10 px-3 text-[12.5px] font-semibold text-[#e4dbff] md:h-8 md:px-3.5 md:text-button">
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
      <div className="flex items-center gap-2 md:hidden">{phoneActions}</div>
    </header>
  )
}

/** 72px (96px on desktop), in a 3px purple → pink → gold ring. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <span
      className="shrink-0 rounded-full p-[3px] size-[82px] md:size-24"
      style={{ background: 'var(--profile-ring)' }}
    >
      {url ? (
        <img src={url} alt={`${name}'s profile picture`} className="size-full rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center rounded-full bg-surface-2 font-heading text-[26px] font-bold text-foreground md:text-[34px]"
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
  reviews,
  followers,
  following,
  onOpenList,
}: {
  reviews?: number
  followers: number
  following: number
  onOpenList: (list: ProfileList) => void
}) {
  return (
    <ul className="-my-1.5 flex flex-wrap items-center gap-x-2" aria-label="Profile counts">
      {reviews !== undefined && (
        <li className="flex w-full items-center gap-1 pt-1.5 text-secondary text-muted-foreground">
          <span className="text-[15px] font-bold tabular-nums text-foreground">
            {reviews.toLocaleString()}
          </span>{' '}
          {reviews === 1 ? 'review' : 'reviews'}
        </li>
      )}
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
                  'grid size-8 place-items-center rounded-full bg-surface-2 font-heading text-meta font-bold text-foreground ring-2 ring-background',
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

/** The phone header's counts: a big number over a small capitalised word. */
function PhoneNum({ value }: { value: number }) {
  return <span className="font-heading text-[18px] font-bold leading-tight tabular-nums">{value.toLocaleString()}</span>
}
function PhoneLabel({ children }: { children: ReactNode }) {
  return <span className="text-[12px] capitalize text-muted-foreground">{children}</span>
}
