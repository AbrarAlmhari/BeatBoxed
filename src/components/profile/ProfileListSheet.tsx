import { useId } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import ProfileFollows from '@/pages/ProfileFollows'
import ProfileArtists from '@/pages/ProfileArtists'

export type ProfileList = 'followers' | 'following' | 'artists'

const TITLES: Record<ProfileList, string> = {
  followers: 'Followers',
  following: 'Following',
  artists: 'Artists followed',
}

/**
 * The lists the profile's counts open: a bottom sheet on phones, a dialog on
 * desktop. The same list components as the full pages, so search, paging
 * and privacy behave identically in both places.
 */
export function ProfileListSheet({
  list,
  userId,
  onClose,
}: {
  list: ProfileList | null
  userId: string
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={list !== null} onClose={onClose} labelledBy={titleId} className="h-[85dvh] sm:h-[70vh]">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-3 sm:pt-5">
        <h2 id={titleId} className="flex-1 text-section-title">
          {list ? TITLES[list] : ''}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {list === 'artists' ? (
          <ProfileArtists userId={userId} embedded />
        ) : list ? (
          <ProfileFollows key={list} kind={list} userId={userId} embedded />
        ) : null}
      </div>
    </Modal>
  )
}
