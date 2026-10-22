import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Lock, MoreHorizontal, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Sheet } from '@/components/ui/Sheet'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { FollowButton } from '@/components/ui/FollowButton'
import { UserFollowButton } from '@/components/people/UserFollowButton'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { getFollowList, getFollowListsVisible, getFollowStates, getFollowedArtistsPage, removeFollower } from '@/lib/catalog'
import type { ArtistCardModel, FollowState, PersonCardModel } from '@/lib/types'

export type ProfileList = 'followers' | 'following' | 'artists'

const TITLES: Record<ProfileList, string> = {
  followers: 'Followers',
  following: 'Following',
  artists: 'Artists',
}

const PAGE = 30

/**
 * The profile's three lists, each opened by its own count: Followers,
 * Following (people only) and Artists (the "Listens to" row; artists only).
 * A bottom sheet on phones, a centred dialog on computers.
 *
 * Every list scrolls and loads more near the bottom. A row opens that
 * profile or artist page and closes the list. People get Follow /
 * Following / Follow back / Requested, artists Follow / Following, and your
 * own row has no button. On your own Followers list a small ⋯ on each row
 * holds Remove follower.
 *
 * `onViewerChange` reports the viewer's follows changing (+1 / -1), so the
 * profile's counts can move straight away when it's their own profile.
 */
export function ProfileListSheet({
  list,
  profile,
  isOwn,
  locked,
  onClose,
  onViewerChange,
}: {
  list: ProfileList | null
  profile: { id: string; name: string }
  isOwn: boolean
  /** Private and the viewer isn't an accepted follower. */
  locked: boolean
  onClose: () => void
  onViewerChange?: (what: 'people' | 'artists' | 'followers', delta: number) => void
}) {
  const titleId = useId()
  const scroller = useRef<HTMLDivElement>(null)
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
      <div ref={scroller} data-list-scroller className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {list === null ? null : locked ? (
          <Private />
        ) : list === 'artists' ? (
          <ArtistList userId={profile.id} name={profile.name} isOwn={isOwn} scroller={scroller} onClose={onClose} onViewerChange={onViewerChange} />
        ) : (
          <PeopleList
            key={list}
            kind={list}
            userId={profile.id}
            name={profile.name}
            isOwn={isOwn}
            scroller={scroller}
            onClose={onClose}
            onViewerChange={onViewerChange}
          />
        )}
      </div>
    </Modal>
  )
}

function Private({ hidden = false, name }: { hidden?: boolean; name?: string }) {
  return (
    <Card padding="lg" className="mt-2 flex flex-col items-center gap-3 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/15">
        <Lock className="size-5 text-accent" strokeWidth={2} aria-hidden />
      </span>
      <p className="text-card-title">
        {hidden ? `${name ?? 'This listener'}'s followers and following are private` : 'This account is private'}
      </p>
      {!hidden && <p className="max-w-sm text-body text-muted-foreground">Follow them to request access.</p>}
    </Card>
  )
}

/* ------------------------------------------------------------ paging */

/**
 * Loads a list a page at a time, and the next page when the end of the list
 * comes into view inside the sheet's scrolling area.
 */
function usePaged<T>(load: (offset: number) => Promise<T[]>, scroller: React.RefObject<HTMLDivElement | null>) {
  const [items, setItems] = useState<T[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  useEffect(() => {
    let live = true
    setStatus('loading')
    load(0)
      .then((page) => {
        if (!live) return
        setItems(page)
        setMore(page.length === PAGE)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('[beatboxed] list failed:', err)
        if (live) setStatus('error')
      })
    return () => {
      live = false
    }
  }, [load])

  const loadMore = useCallback(async () => {
    if (busy.current || !more) return
    busy.current = true
    setLoadingMore(true)
    try {
      const page = await load(items.length)
      setItems((prev) => [...prev, ...page])
      setMore(page.length === PAGE)
    } catch (err) {
      console.error('[beatboxed] list page failed:', err)
    } finally {
      busy.current = false
      setLoadingMore(false)
    }
  }, [load, items.length, more])

  useEffect(() => {
    const el = end.current
    if (!el || !more) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), {
      root: scroller.current,
      rootMargin: '300px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [more, loadMore, scroller, status])

  const footer =
    status === 'ready' && more ? (
      <div ref={end} className="flex min-h-12 items-center justify-center" aria-hidden={!loadingMore}>
        {loadingMore && (
          <span role="status" className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading more…
          </span>
        )}
      </div>
    ) : null

  return { items, setItems, status, footer }
}

function Loading() {
  return (
    <div role="status" className="pt-2">
      <span className="sr-only">Loading…</span>
      <SkeletonList rows={5} cover="size-11 rounded-full" />
    </div>
  )
}

/* ------------------------------------------------------------ people */

function PeopleList({
  kind,
  userId,
  name,
  isOwn,
  scroller,
  onClose,
  onViewerChange,
}: {
  kind: 'followers' | 'following'
  userId: string
  name: string
  isOwn: boolean
  scroller: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onViewerChange?: (what: 'people' | 'artists' | 'followers', delta: number) => void
}) {
  const { user } = useAuth()
  const [states, setStates] = useState<Map<string, FollowState>>(new Map())
  const [hidden, setHidden] = useState(false)

  const load = useCallback(
    async (offset: number) => {
      if (offset === 0 && !isOwn) setHidden(!(await getFollowListsVisible(userId)))
      const page = await getFollowList(userId, kind, { limit: PAGE, offset })
      if (user && page.length) {
        const s = await getFollowStates(user.id, page.map((p) => p.id))
        setStates((prev) => new Map([...prev, ...s]))
      }
      return page
    },
    [userId, kind, user, isOwn]
  )
  const { items, setItems, status, footer } = usePaged<PersonCardModel>(load, scroller)

  if (status === 'loading') return <Loading />
  if (hidden) return <Private hidden name={name} />
  if (status === 'error') return <EmptyState face="sad" compact title="Couldn't load this list" detail="Check your connection and try again." />
  if (items.length === 0) {
    return (
      <EmptyState
        face="sleepy-sticker"
        compact
        title={kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
        detail={
          isOwn
            ? kind === 'followers'
              ? 'When people follow you, they show up here.'
              : 'Find people in Explore and follow them.'
            : kind === 'followers'
              ? `Nobody follows ${name} yet.`
              : `${name} isn't following anyone yet.`
        }
      />
    )
  }

  return (
    <ul className="flex flex-col gap-3 pt-1" aria-label={kind === 'followers' ? 'Followers' : 'Following'}>
      {items.map((person) => {
        const state = states.get(person.id) ?? 'none'
        const self = user?.id === person.id
        return (
          <Row
            key={person.id}
            to={`/profile/${person.id}`}
            onOpen={onClose}
            picture={<PersonPicture person={person} />}
            title={person.displayName || person.username || 'Listener'}
            subtitle={person.username ? `@${person.username}` : null}
          >
            {!self && (
              <UserFollowButton
                personId={person.id}
                state={state}
                followLabel={isOwn && kind === 'followers' ? 'Follow back' : undefined}
                onChange={(next, previous) => {
                  setStates((prev) => new Map(prev).set(person.id, next))
                  const delta = (next === 'following' ? 1 : 0) - (previous === 'following' ? 1 : 0)
                  if (delta) onViewerChange?.('people', delta)
                }}
              />
            )}
            {isOwn && kind === 'followers' && !self && (
              <RemoveFollowerMenu
                person={person}
                onRemoved={() => {
                  setItems((prev) => prev.filter((p) => p.id !== person.id))
                  onViewerChange?.('followers', -1)
                }}
              />
            )}
          </Row>
        )
      })}
      {footer}
    </ul>
  )
}

function PersonPicture({ person }: { person: PersonCardModel }) {
  const name = person.displayName || person.username || 'Listener'
  return person.avatarUrl ? (
    <img src={person.avatarUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/** Your own Followers list: ⋯ on a row, then a short confirmation. */
function RemoveFollowerMenu({ person, onRemoved }: { person: PersonCardModel; onRemoved: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const handle = person.username ? `@${person.username}` : person.displayName || 'this listener'

  function close() {
    setOpen(false)
    setConfirming(false)
  }

  async function remove() {
    if (!user) return
    setPending(true)
    try {
      await removeFollower(user.id, person.id)
      close()
      onRemoved()
      toast.show({ message: `Removed ${handle} from your followers` })
    } catch (err) {
      console.error('[beatboxed] remove follower failed:', err)
      toast.show({ message: "Couldn't remove. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`More options for ${handle}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:bg-white/5 hover:text-foreground"
      >
        <MoreHorizontal className="size-5" strokeWidth={2} />
      </button>
      <Sheet open={open} onClose={close} title="Follower options" className="sm:w-64">
        {confirming ? (
          <div className="flex flex-col gap-2 p-1">
            <p className="px-2 pt-1 text-body">
              Remove <span dir="auto">{handle}</span> from your followers? They won't be told.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={pending}
                className="min-h-11 flex-1 rounded-button bg-danger/15 px-3 text-button text-danger transition-colors duration-200 ease-soft hover:bg-danger/25 disabled:opacity-60"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 flex-1 rounded-button bg-surface-2 px-3 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex min-h-11 w-full items-center gap-3 rounded-button px-3 text-left text-body text-danger hover:bg-white/5"
          >
            Remove follower
          </button>
        )}
      </Sheet>
    </div>
  )
}

/* ------------------------------------------------------------ artists */

function ArtistList({
  userId,
  name,
  isOwn,
  scroller,
  onClose,
  onViewerChange,
}: {
  userId: string
  name: string
  isOwn: boolean
  scroller: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onViewerChange?: (what: 'people' | 'artists' | 'followers', delta: number) => void
}) {
  const load = useCallback((offset: number) => getFollowedArtistsPage(userId, { limit: PAGE, offset }), [userId])
  const { items, status, footer } = usePaged<ArtistCardModel>(load, scroller)

  if (status === 'loading') return <Loading />
  if (status === 'error') return <EmptyState face="sad" compact title="Couldn't load this list" detail="Check your connection and try again." />
  if (items.length === 0) {
    return (
      <EmptyState
        face="sleepy-sticker"
        compact
        title="No artists yet"
        detail={isOwn ? 'Follow an artist from a song page or from search.' : `${name} isn't following any artists yet.`}
      />
    )
  }

  return (
    <ul className="flex flex-col gap-3 pt-1" aria-label="Artists">
      {items.map((artist) => (
        <Row
          key={artist.id}
          to={`/artist/${artist.id}`}
          onOpen={onClose}
          picture={
            artist.imageUrl ? (
              <img src={artist.imageUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
                {artist.name.charAt(0).toUpperCase()}
              </span>
            )
          }
          title={artist.name}
          subtitle="Artist"
        >
          <FollowButton
            artistId={artist.id}
            size="sm"
            onChange={(following) => onViewerChange?.('artists', following ? 1 : -1)}
          />
        </Row>
      ))}
      {footer}
    </ul>
  )
}

/* ------------------------------------------------------------ a row */

/**
 * One row, in the same card as the app's other people lists. The picture
 * and name open the page (and close the list); the buttons sit outside
 * that link, so they never open it by accident.
 */
function Row({
  to,
  onOpen,
  picture,
  title,
  subtitle,
  children,
}: {
  to: string
  onOpen: () => void
  picture: ReactNode
  title: string
  subtitle: string | null
  children?: ReactNode
}) {
  return (
    <li className="flex items-center gap-2 rounded-card border border-line bg-surface p-3 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2">
      <Link to={to} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3">
        {picture}
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate text-card-title">
            {title}
          </span>
          {subtitle && <span className="truncate text-secondary text-muted-foreground">{subtitle}</span>}
        </span>
      </Link>
      {children}
    </li>
  )
}
