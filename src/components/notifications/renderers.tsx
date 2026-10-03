import { Disc3, Heart, Megaphone, MessageCircle, UserCheck } from 'lucide-react'
import type { Announcement, NotificationRow, PersonCardModel } from '@/lib/types'

/** Looked up at render time, so names and titles are never stale. */
export type RenderContext = {
  people: Map<string, PersonCardModel>
  songs: Map<string, string>
  comments: Map<string, string>
  /** Artist id -> name and picture, for release notifications. */
  artists: Map<string, { name: string; imageUrl: string | null }>
  /** Album id -> title and cover. */
  albums: Map<string, { title: string; coverUrl: string | null }>
}

export type RenderedNotification = {
  /** Actor avatar with a small badge, or a plain icon for system items. */
  avatar: React.ReactNode
  body: React.ReactNode
  /** Where clicking takes you, or null to stay put. */
  href: string | null
  /** Whose profile the avatar links to, when there is an actor. */
  actorId: string | null
}

/** Drives the filter chips. 'artists' has no producers yet, by design. */
export type NotificationCategory = 'social' | 'artists' | 'beatboxed'

/** type -> which chip it belongs under. */
export const NOTIFICATION_CATEGORIES: Record<string, NotificationCategory> = {
  friend_accepted: 'social',
  review_liked: 'social',
  review_commented: 'social',
  thread_reply: 'social',
  artist_release: 'artists',
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

function nameOf(id: string | null, ctx: RenderContext) {
  if (!id) return 'Someone'
  const p = ctx.people.get(id)
  return p?.displayName || p?.username || 'Someone'
}

/** Actor's avatar with the action badged onto it, Instagram-style. */
function Avatar({
  person,
  badge,
  extra,
}: {
  person: PersonCardModel | undefined
  badge: React.ReactNode
  /** "+4" when several people did the same thing. */
  extra?: number
}) {
  const name = person?.displayName || person?.username || '?'
  return (
    <span className="relative shrink-0">
      {person?.avatarUrl ? (
        <img src={person.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
      ) : (
        <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-background">
        {badge}
      </span>
      {extra && extra > 0 ? (
        <span className="absolute -left-1 -top-1 grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </span>
  )
}

const heart = <Heart className="size-3.5 fill-primary text-primary" strokeWidth={2} />
const bubble = <MessageCircle className="size-3.5 text-primary" strokeWidth={2.25} />
const check = <UserCheck className="size-3.5 text-primary" strokeWidth={2.25} />

/** Deep link to the exact review, and the thread when there is a comment. */
function reviewHref(payload: Record<string, unknown>) {
  const song = str(payload.song_id)
  const review = str(payload.review_id)
  if (!song || !review) return null
  const comment = str(payload.comment_id)
  return `/song/${song}?review=${review}${comment ? `&comment=${comment}` : ''}`
}

function snippet(body: string | undefined, words = 6) {
  if (!body) return null
  const parts = body.trim().split(/\s+/)
  return parts.slice(0, words).join(' ') + (parts.length > words ? '…' : '')
}

export type NotificationRenderer = (
  n: NotificationRow,
  ctx: RenderContext,
  /** Other actors when several people did the same thing to the same thing. */
  alsoActorIds?: string[]
) => RenderedNotification | null

const friendAccepted: NotificationRenderer = (n, ctx) => {
  // Older rows used friend_id; notify() writes actor_id.
  const id = str(n.payload.actor_id) ?? str(n.payload.friend_id)
  if (!id) return null
  return {
    avatar: <Avatar person={ctx.people.get(id)} badge={check} />,
    body: (
      <>
        <span className="text-foreground">{nameOf(id, ctx)}</span>
        <span className="text-muted-foreground"> accepted your friend request.</span>
      </>
    ),
    href: `/profile/${id}`,
    actorId: id,
  }
}

const reviewLiked: NotificationRenderer = (n, ctx, alsoActorIds = []) => {
  const actor = str(n.payload.actor_id)
  const song = str(n.payload.song_id)
  if (!actor) return null

  const title = song ? ctx.songs.get(song) : null
  const others = alsoActorIds.length

  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge={heart} extra={others} />,
    body: (
      <>
        <span className="text-foreground">{nameOf(actor, ctx)}</span>
        {others > 0 && (
          <span className="text-foreground">
            {' '}and {others} other{others > 1 ? 's' : ''}
          </span>
        )}
        <span className="text-muted-foreground">
          {' '}liked your review{title ? ' of ' : ''}
        </span>
        {title && <span dir="auto" className="text-foreground">{title}</span>}
      </>
    ),
    href: reviewHref(n.payload),
    actorId: actor,
  }
}

const reviewCommented: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const text = snippet(ctx.comments.get(str(n.payload.comment_id) ?? ''))

  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge={bubble} />,
    body: (
      <>
        <span className="text-foreground">{nameOf(actor, ctx)}</span>
        <span className="text-muted-foreground"> commented on your review</span>
        {text && (
          <span dir="auto" className="text-muted-foreground">: “{text}”</span>
        )}
      </>
    ),
    href: reviewHref(n.payload),
    actorId: actor,
  }
}

const threadReply: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  const author = str(n.payload.review_author_id)
  const song = str(n.payload.song_id)
  if (!actor) return null

  const title = song ? ctx.songs.get(song) : null

  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge={bubble} />,
    body: (
      <>
        <span className="text-foreground">{nameOf(actor, ctx)}</span>
        <span className="text-muted-foreground"> also commented on </span>
        <span className="text-foreground">{nameOf(author, ctx)}’s</span>
        <span className="text-muted-foreground"> review{title ? ' of ' : ''}</span>
        {title && <span dir="auto" className="text-foreground">{title}</span>}
      </>
    ),
    href: reviewHref(n.payload),
    actorId: actor,
  }
}

/**
 * type -> renderer. A new social type is a trigger calling notify() plus one
 * entry here. An unknown type renders nothing rather than throwing, so a
 * trigger can ship before the UI that understands it.
 */
/**
 * A release, not a person: the actor is the artist, so the avatar is their
 * picture and the album cover rides alongside it. Tapping opens the album.
 */
const artistRelease: NotificationRenderer = (n, ctx) => {
  const artistId = str(n.payload.actor_id) ?? str(n.payload.artist_id)
  const albumId = str(n.payload.album_id)
  if (!artistId || !albumId) return null

  const artist = ctx.artists.get(artistId)
  const album = ctx.albums.get(albumId)

  return {
    avatar: (
      <span className="relative shrink-0">
        {artist?.imageUrl ? (
          <img
            src={artist.imageUrl}
            alt=""
            className="size-10 rounded-full object-cover"
          />
        ) : (
          <span className="grid size-10 place-items-center rounded-full bg-surface-2">
            <Disc3 className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-background">
          <Disc3 className="size-3.5 text-primary" strokeWidth={2.25} />
        </span>
      </span>
    ),
    body: (
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground">New release from </span>
          <span className="text-foreground">{artist?.name ?? 'an artist'}</span>
          {album?.title && (
            <>
              <span className="text-muted-foreground">: </span>
              <span className="text-foreground">{album.title}</span>
            </>
          )}
        </span>
        {album?.coverUrl && (
          <img
            src={album.coverUrl}
            alt=""
            className="size-10 shrink-0 rounded-[6px] object-cover"
          />
        )}
      </span>
    ),
    href: `/album/${albumId}`,
    // The actor is an artist, not a profile, so there's no person to open.
    actorId: null,
  }
}

export const NOTIFICATION_RENDERERS: Record<string, NotificationRenderer> = {
  friend_accepted: friendAccepted,
  review_liked: reviewLiked,
  review_commented: reviewCommented,
  thread_reply: threadReply,
  artist_release: artistRelease,
}

export function renderAnnouncement(a: Announcement): RenderedNotification {
  return {
    avatar: (
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2">
        <Megaphone className="size-4 text-primary" strokeWidth={2} />
      </span>
    ),
    body: (
      <>
        <span className="text-foreground">{a.title}</span>
        <span className="block text-muted-foreground">{a.body}</span>
      </>
    ),
    href: a.link,
    actorId: null,
  }
}
