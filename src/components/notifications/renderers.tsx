import { AtSign, Disc3, Heart, Megaphone, MessageSquare, Plus, UserCheck } from 'lucide-react'
import { PersonAvatar } from '@/components/conversations/PersonAvatar'
import { commentSegments } from '@/lib/conversations'
import type { NotificationContext } from '@/lib/catalog'
import type { Announcement, NotificationRow, PersonCardModel } from '@/lib/types'
import { cn } from '@/lib/cn'

/** Looked up at render time, so names and titles are never stale. */
export type RenderContext = NotificationContext

export type RenderedNotification = {
  /** Actor avatar with a coloured badge, or a plain icon for system items. */
  avatar: React.ReactNode
  /** The sentence: "TrulyMe replied to your comment on Reflections". */
  body: React.ReactNode
  /** The comment, quoted under the sentence. */
  quote: string | null
  /** The song's cover on the right. */
  coverUrl: string | null
  /** Where clicking takes you, or null to stay put. */
  href: string | null
  /** Whose profile the avatar links to, when there is an actor. */
  actorId: string | null
  /** Reply and mention rows: the comment the Reply and Like buttons act on. */
  commentId: string | null
}

/** The filter chips. Announcements are 'beatboxed'. */
export type NotificationCategory = 'mentions' | 'replies' | 'likes' | 'follows' | 'artists' | 'beatboxed'

/** type -> which chip it belongs under. */
export const NOTIFICATION_CATEGORIES: Record<string, NotificationCategory> = {
  mention: 'mentions',
  comment_reply: 'replies',
  thread_reply: 'replies',
  review_commented: 'replies',
  review_liked: 'likes',
  comment_liked: 'likes',
  new_follower: 'follows',
  follow_requested: 'follows',
  follow_accepted: 'follows',
  artist_release: 'artists',
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

function nameOf(id: string | null, ctx: RenderContext) {
  if (!id) return 'Someone'
  const p = ctx.people.get(id)
  return p?.displayName || p?.username || 'Someone'
}

type Badge = 'reply' | 'mention' | 'like' | 'follow'

const BADGE: Record<Badge, { className: string; icon: React.ReactNode; label: string }> = {
  reply: {
    className: 'bg-primary',
    icon: <MessageSquare className="size-3 fill-white text-white" strokeWidth={2} />,
    label: 'Reply',
  },
  mention: {
    className: 'bg-badge-mention',
    icon: <AtSign className="size-3.5 text-white" strokeWidth={2.5} />,
    label: 'Mention',
  },
  like: {
    className: 'bg-like',
    icon: <Heart className="size-3 fill-white text-white" strokeWidth={0} />,
    label: 'Like',
  },
  follow: {
    className: 'bg-badge-follow',
    icon: <Plus className="size-3.5 text-white" strokeWidth={3} />,
    label: 'Follow',
  },
}

/** The actor's avatar with what they did badged onto its corner. */
function Avatar({ person, badge }: { person: PersonCardModel | undefined; badge: Badge }) {
  const name = person?.displayName || person?.username || '?'
  const b = BADGE[badge]
  return (
    <span className="relative shrink-0">
      <PersonAvatar name={name} url={person?.avatarUrl} className="size-11 text-card-title" />
      <span
        role="img"
        aria-label={b.label}
        className={cn(
          'absolute -bottom-1 -right-1 grid size-[22px] place-items-center rounded-full ring-[3px] ring-background',
          b.className
        )}
      >
        {b.icon}
      </span>
    </span>
  )
}

/** Deep link to the exact review, and the comment when there is one. */
function reviewHref(payload: Record<string, unknown>) {
  const song = str(payload.song_id)
  const review = str(payload.review_id)
  if (!song || !review) return null
  const comment = str(payload.comment_id)
  return `/song/${song}?review=${review}${comment ? `&comment=${comment}` : ''}`
}

/** The comment as plain text, mentions as @username. */
function quoteOf(n: NotificationRow, ctx: RenderContext) {
  const c = ctx.comments.get(str(n.payload.comment_id) ?? '')
  if (!c || !c.body) return null
  return commentSegments(
    c.body,
    [...ctx.people.values()].map((p) => ({ id: p.id, username: p.username, displayName: p.displayName }))
  )
    .map((s) => (s.kind === 'text' ? s.text : `@${s.person.username}`))
    .join('')
}

const songTitle = (n: NotificationRow, ctx: RenderContext) =>
  ctx.songs.get(str(n.payload.song_id) ?? '')?.title ?? null
const songCover = (n: NotificationRow, ctx: RenderContext) =>
  ctx.songs.get(str(n.payload.song_id) ?? '')?.coverUrl ?? null

const Who = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-foreground">{children}</span>
)

export type NotificationRenderer = (
  n: NotificationRow,
  ctx: RenderContext,
  /** Other actors when several people did the same thing to the same thing. */
  alsoActorIds?: string[]
) => RenderedNotification | null

/** The follow types share a shape: one person, one sentence, their profile. */
function followRenderer(sentence: string, href?: string, badge: Badge = 'follow'): NotificationRenderer {
  return (n, ctx) => {
    const id = str(n.payload.actor_id)
    if (!id) return null
    return {
      avatar: <Avatar person={ctx.people.get(id)} badge={badge} />,
      body: (
        <>
          <Who>{nameOf(id, ctx)}</Who> {sentence}
        </>
      ),
      quote: null,
      coverUrl: null,
      href: href ?? `/profile/${id}`,
      actorId: id,
      commentId: null,
    }
  }
}

/** Someone and maybe others: "ory and 2 others". */
function actors(actor: string, ctx: RenderContext, also: string[]) {
  const others = new Set(also.filter((a) => a !== actor)).size
  return (
    <>
      <Who>{nameOf(actor, ctx)}</Who>
      {others > 0 && (
        <Who>
          {' '}
          and {others} other{others > 1 ? 's' : ''}
        </Who>
      )}
    </>
  )
}

const reviewLiked: NotificationRenderer = (n, ctx, also = []) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const title = songTitle(n, ctx)
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="like" />,
    body: (
      <>
        {actors(actor, ctx, also)} liked your review{title ? ' of ' : ''}
        {title && <span dir="auto">{title}</span>}
      </>
    ),
    quote: null,
    coverUrl: songCover(n, ctx),
    href: reviewHref({ ...n.payload, comment_id: null }),
    actorId: actor,
    commentId: null,
  }
}

const commentLiked: NotificationRenderer = (n, ctx, also = []) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const isReply = ctx.comments.get(str(n.payload.comment_id) ?? '')?.isReply
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="like" />,
    body: (
      <>
        {actors(actor, ctx, also)} liked your {isReply ? 'reply' : 'comment'}
      </>
    ),
    quote: quoteOf(n, ctx),
    coverUrl: songCover(n, ctx),
    href: reviewHref(n.payload),
    actorId: actor,
    commentId: null,
  }
}

const commentReply: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const title = songTitle(n, ctx)
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="reply" />,
    body: (
      <>
        <Who>{nameOf(actor, ctx)}</Who> replied to your comment{title ? ' on ' : ''}
        {title && <span dir="auto">{title}</span>}
      </>
    ),
    quote: quoteOf(n, ctx),
    coverUrl: songCover(n, ctx),
    href: reviewHref(n.payload),
    actorId: actor,
    commentId: str(n.payload.comment_id),
  }
}

const mention: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const isReply = ctx.comments.get(str(n.payload.comment_id) ?? '')?.isReply
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="mention" />,
    body: (
      <>
        <Who>{nameOf(actor, ctx)}</Who> mentioned you in a {isReply ? 'reply' : 'comment'}
      </>
    ),
    quote: quoteOf(n, ctx),
    coverUrl: songCover(n, ctx),
    href: reviewHref(n.payload),
    actorId: actor,
    commentId: str(n.payload.comment_id),
  }
}

const reviewCommented: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  const title = songTitle(n, ctx)
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="reply" />,
    body: (
      <>
        <Who>{nameOf(actor, ctx)}</Who> commented on your review{title ? ' of ' : ''}
        {title && <span dir="auto">{title}</span>}
      </>
    ),
    quote: quoteOf(n, ctx),
    coverUrl: songCover(n, ctx),
    href: reviewHref(n.payload),
    actorId: actor,
    commentId: str(n.payload.comment_id),
  }
}

const threadReply: NotificationRenderer = (n, ctx) => {
  const actor = str(n.payload.actor_id)
  if (!actor) return null
  // Older rows (before replies existed) meant "commented on a review you
  // commented on"; they have no thread_id.
  const threaded = str(n.payload.thread_id) !== null
  const author = str(n.payload.review_author_id)
  const title = songTitle(n, ctx)
  return {
    avatar: <Avatar person={ctx.people.get(actor)} badge="reply" />,
    body: threaded ? (
      <>
        <Who>{nameOf(actor, ctx)}</Who> replied in a thread you’re in
      </>
    ) : (
      <>
        <Who>{nameOf(actor, ctx)}</Who> also commented on {nameOf(author, ctx)}’s review
        {title ? ' of ' : ''}
        {title && <span dir="auto">{title}</span>}
      </>
    ),
    quote: quoteOf(n, ctx),
    coverUrl: songCover(n, ctx),
    href: reviewHref(n.payload),
    actorId: actor,
    commentId: str(n.payload.comment_id),
  }
}

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
          <img src={artist.imageUrl} alt="" className="size-11 rounded-full object-cover" />
        ) : (
          <span className="grid size-11 place-items-center rounded-full bg-surface-2">
            <Disc3 className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 grid size-[22px] place-items-center rounded-full bg-surface-2 ring-[3px] ring-background">
          <Disc3 className="size-3.5 text-primary" strokeWidth={2.25} />
        </span>
      </span>
    ),
    body: (
      <>
        New release from <Who>{artist?.name ?? 'an artist'}</Who>
        {album?.title && (
          <>
            : <Who>{album.title}</Who>
          </>
        )}
      </>
    ),
    quote: null,
    coverUrl: album?.coverUrl ?? null,
    href: `/album/${albumId}`,
    // The actor is an artist, not a profile, so there's no person to open.
    actorId: null,
    commentId: null,
  }
}

/**
 * type -> renderer. A new type is a trigger calling notify() plus one entry
 * here. An unknown type renders nothing rather than throwing, so a trigger
 * can ship before the UI that understands it.
 */
export const NOTIFICATION_RENDERERS: Record<string, NotificationRenderer> = {
  new_follower: followRenderer('started following you'),
  // Normally shown by the Follow requests row instead (getNotificationCenter
  // leaves these out of the list); rendered here so one is never blank.
  follow_requested: followRenderer('requested to follow you', '/notifications/requests'),
  follow_accepted: (n, ctx, also) => {
    const r = followRenderer('accepted your follow request')(n, ctx, also)
    return r && { ...r, avatar: <AcceptedAvatar person={ctx.people.get(str(n.payload.actor_id) ?? '')} /> }
  },
  review_liked: reviewLiked,
  comment_liked: commentLiked,
  review_commented: reviewCommented,
  comment_reply: commentReply,
  thread_reply: threadReply,
  mention,
  artist_release: artistRelease,
}

function AcceptedAvatar({ person }: { person: PersonCardModel | undefined }) {
  const name = person?.displayName || person?.username || '?'
  return (
    <span className="relative shrink-0">
      <PersonAvatar name={name} url={person?.avatarUrl} className="size-11 text-card-title" />
      <span
        role="img"
        aria-label="Follow"
        className="absolute -bottom-1 -right-1 grid size-[22px] place-items-center rounded-full bg-badge-follow ring-[3px] ring-background"
      >
        <UserCheck className="size-3 text-white" strokeWidth={2.5} />
      </span>
    </span>
  )
}

export function renderAnnouncement(a: Announcement): RenderedNotification {
  return {
    avatar: (
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2">
        <Megaphone className="size-4 text-primary" strokeWidth={2} />
      </span>
    ),
    body: (
      <>
        <Who>{a.title}</Who>
        <span className="block">{a.body}</span>
      </>
    ),
    quote: null,
    coverUrl: null,
    href: a.link,
    actorId: null,
    commentId: null,
  }
}
