import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { ProfileHero } from '@/components/profile/ProfileHero'
import { ProfileTabBar, PROFILE_TABS, PROFILE_TABS_ID, type ProfileTab } from '@/components/profile/ProfileTabBar'
import { TabPanel } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ProfileReviewsTab } from '@/components/profile/ProfileReviewsTab'
import { ProfilePlaylistsTab } from '@/components/profile/ProfilePlaylistsTab'
import { ProfileLikesTab } from '@/components/profile/ProfileLikesTab'
import { ProfileStatsTab } from '@/components/profile/ProfileStatsTab'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProfileListSheet, type ProfileList } from '@/components/profile/ProfileListSheet'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { ReviewComposer } from '@/components/feed/ReviewComposer'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { getFollowStates, getProfileDetail } from '@/lib/catalog'
import { getWrittenReviewCount, type ReviewFilter } from '@/lib/profile'
import type { FollowState, ProfileDetail } from '@/lib/types'

const FILTERS: ReviewFilter[] = ['all', 'written', 'ratings']

/**
 * A profile: header with counts, then Reviews · Playlists · Stats · Likes.
 *
 * The tab (and the Reviews filter) live in the URL, e.g.
 * /profile/:id?tab=likes, so links and the back button work.
 *
 * A private account shows its header and counts to everyone; to anyone who
 * isn't an accepted follower the tabs are replaced by a lock card. RLS
 * already returns no rows to those viewers — the card says why.
 */
export default function Profile() {
  const { userId } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  // /profile is your own; /profile/:userId is anyone's.
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [profile, setProfile] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [followState, setFollowState] = useState<FollowState>('none')
  const [followKnown, setFollowKnown] = useState(false)
  const [writtenCount, setWrittenCount] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [list, setList] = useState<ProfileList | null>(null)
  const [composing, setComposing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const tabsRef = useRef<HTMLDivElement>(null)

  const rawTab = params.get('tab')
  const tab: ProfileTab = PROFILE_TABS.some((t) => t.id === rawTab) ? (rawTab as ProfileTab) : 'reviews'
  const rawFilter = params.get('filter')
  const filter: ReviewFilter = FILTERS.includes(rawFilter as ReviewFilter) ? (rawFilter as ReviewFilter) : 'all'

  /** Tab changes are history entries, so Back returns to the last tab. */
  const go = useCallback(
    (next: ProfileTab, nextFilter: ReviewFilter = 'all') => {
      setParams((prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'reviews') p.delete('tab')
        else p.set('tab', next)
        if (next === 'reviews' && nextFilter !== 'all') p.set('filter', nextFilter)
        else p.delete('filter')
        return p
      })
    },
    [setParams]
  )

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setEditing(false)
    setList(null)
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

  // Whether the viewer follows this person, so the button and the lock are
  // right even when the follow happened elsewhere.
  useEffect(() => {
    setFollowKnown(false)
    if (!user || !targetId || isOwn) {
      setFollowState('none')
      setFollowKnown(true)
      return
    }
    let cancelled = false
    getFollowStates(user.id, [targetId])
      .then((m) => {
        if (!cancelled) setFollowState(m.get(targetId) ?? 'none')
      })
      .catch((err) => console.warn('[beatboxed] follow state failed:', err))
      .finally(() => {
        if (!cancelled) setFollowKnown(true)
      })
    return () => {
      cancelled = true
    }
  }, [user, targetId, isOwn])

  const locked = Boolean(profile?.isPrivate) && !isOwn && followState !== 'following'

  // Written reviews are counted through RLS, so only where they're visible;
  // a locked profile leaves the number out rather than showing 0.
  useEffect(() => {
    setWrittenCount(null)
    if (!profile || !followKnown || locked) return
    let cancelled = false
    getWrittenReviewCount(profile.id)
      .then((n) => {
        if (!cancelled) setWrittenCount(n)
      })
      .catch((err) => console.warn('[beatboxed] written count failed:', err))
    return () => {
      cancelled = true
    }
  }, [profile, followKnown, locked, reloadKey])

  if (loading) return <ProfileSkeleton />

  if (!profile) {
    return (
      <EmptyState
        face="sad"
        title="Profile not found"
        detail="This account doesn't exist, or the link is wrong."
      />
    )
  }

  if (editing) {
    return (
      <div className="pt-2">
        <ProfileEditor
          profile={profile}
          onSaved={(next) => {
            setProfile(next)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  const name = profile.displayName || profile.username || 'Listener'
  const handle = profile.username ? `@${profile.username}` : name

  return (
    <div className="relative isolate flex flex-col gap-5 pb-4">
      <ProfileHero
        profile={profile}
        isOwn={isOwn}
        writtenCount={locked ? null : writtenCount}
        followState={followState}
        hideFollow={locked}
        onFollowChange={(next, previous) => {
          setFollowState(next)
          // Only an accepted follow moves their follower count; a pending
          // request doesn't count until it's approved.
          const delta = (next === 'following' ? 1 : 0) - (previous === 'following' ? 1 : 0)
          if (delta !== 0) {
            setProfile((p) => (p ? { ...p, followerCount: Math.max(0, p.followerCount + delta) } : p))
          }
        }}
        onOpenList={setList}
        onShowReviews={(written) => {
          if (locked) return
          go('reviews', written ? 'written' : 'all')
          tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        onEdit={() => setEditing(true)}
      />

      {locked ? (
        <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-primary/15">
            <Lock className="size-5 text-accent" strokeWidth={2} aria-hidden />
          </span>
          <p className="max-w-sm text-body text-foreground">
            This account is private. Follow to see their reviews, playlists and stats.
          </p>
          <UserFollowButton
            personId={profile.id}
            state={followState}
            isPrivate
            size="lg"
            onChange={(next) => setFollowState(next)}
          />
        </Card>
      ) : (
        <div ref={tabsRef} className="flex scroll-mt-16 flex-col gap-4">
          <ProfileTabBar tab={tab} onChange={(t) => go(t)} />
          <TabPanel idPrefix={PROFILE_TABS_ID} value={tab}>
            {tab === 'reviews' && (
              <ProfileReviewsTab
                userId={profile.id}
                isOwn={isOwn}
                handle={handle}
                filter={filter}
                onFilterChange={(f) => go('reviews', f)}
                onWrite={() => setComposing(true)}
                reloadKey={reloadKey}
              />
            )}
            {tab === 'playlists' && <ProfilePlaylistsTab userId={profile.id} isOwn={isOwn} handle={handle} />}
            {tab === 'stats' && <ProfileStatsTab userId={profile.id} isOwn={isOwn} handle={handle} />}
            {tab === 'likes' && <ProfileLikesTab userId={profile.id} isOwn={isOwn} handle={handle} />}
          </TabPanel>
        </div>
      )}

      <ProfileListSheet list={list} userId={profile.id} onClose={() => setList(null)} />

      {isOwn && (
        <ReviewComposer
          open={composing}
          onClose={() => setComposing(false)}
          onPosted={() => {
            setComposing(false)
            setReloadKey((n) => n + 1)
            setProfile((p) => (p ? { ...p, reviewCount: p.reviewCount + 1 } : p))
            toast.show({ message: 'Review posted' })
          }}
        />
      )}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5 pt-2" aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton className="size-[72px] rounded-full md:size-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
      <Skeleton className="h-11 w-36 rounded-button md:hidden" />
      <div className="flex gap-6 border-b border-line-strong pb-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      <Skeleton tone="page" className="h-40 rounded-card" />
    </div>
  )
}
