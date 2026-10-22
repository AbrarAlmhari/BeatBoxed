import { Tabs, panelIdFor, tabIdFor } from '@/components/ui/Tabs'

export type ProfileTab = 'reviews' | 'playlists' | 'stats' | 'likes'

export const PROFILE_TABS: { id: ProfileTab; label: React.ReactNode }[] = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'stats', label: 'Stats' },
  { id: 'likes', label: 'Likes' },
]

export const PROFILE_TABS_ID = 'profile'
export const tabId = (t: ProfileTab) => tabIdFor(PROFILE_TABS_ID, t)
export const panelId = (t: ProfileTab) => panelIdFor(PROFILE_TABS_ID, t)

/**
 * Reviews · Playlists · Stats · Likes: the shared Tabs, sticky. On phones the
 * app's top bar is hidden on the profile, so the bar sticks at the very top.
 */
export function ProfileTabBar({
  tab,
  onChange,
  reviewCount,
}: {
  tab: ProfileTab
  onChange: (next: ProfileTab) => void
  /** Shown on the Reviews tab ("Reviews 19"). */
  reviewCount?: number
}) {
  const tabs =
    reviewCount === undefined
      ? PROFILE_TABS
      : PROFILE_TABS.map((t) =>
          t.id === 'reviews'
            ? {
                ...t,
                label: (
                  <>
                    Reviews <span className="ml-1 text-meta font-bold tabular-nums text-accent">{reviewCount.toLocaleString()}</span>
                  </>
                ),
              }
            : t
        )
  return (
    <Tabs
      tabs={tabs}
      value={tab}
      onChange={onChange}
      label="Profile"
      idPrefix={PROFILE_TABS_ID}
      sticky
      stickyTop="top-0 md:top-16"
    />
  )
}
