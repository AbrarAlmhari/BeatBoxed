import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Heart, Users } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonList } from '@/components/ui/Skeleton'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_RENDERERS,
  renderAnnouncement,
  type NotificationCategory,
  type RenderContext,
  type RenderedNotification,
} from '@/components/notifications/renderers'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import {
  getNotificationCenter,
  getNotificationContext,
  getNotificationUnreadCounts,
  markAllRead,
  markAnnouncementRead,
  markNotificationRead,
} from '@/lib/catalog'
import { setCommentLike } from '@/lib/conversations'
import { cn } from '@/lib/cn'
import type { NotificationCenter, UpdateItem } from '@/lib/types'

type Filter = 'all' | NotificationCategory

const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: 'all', label: 'All', empty: 'New activity will show up here.' },
  { value: 'mentions', label: 'Mentions', empty: 'When someone @mentions you, it shows up here.' },
  { value: 'replies', label: 'Replies', empty: 'Replies to your comments and reviews show up here.' },
  { value: 'likes', label: 'Likes', empty: 'Likes on your reviews, comments and replies show up here.' },
  { value: 'follows', label: 'Follows', empty: 'New followers show up here.' },
  { value: 'artists', label: 'Artists', empty: 'New releases from artists you follow show up here.' },
  { value: 'beatboxed', label: 'Beatboxed', empty: 'News from the Beatboxed team shows up here.' },
]

/** Compact "2h" style — these sit in a dense list. */
function shortAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / 604800)}w`
}

const EMPTY_CTX: RenderContext = {
  people: new Map(),
  songs: new Map(),
  comments: new Map(),
  artists: new Map(),
  albums: new Map(),
}

/** One row on the page: a notification, or several grouped into one. */
type Display = { item: UpdateItem; alsoActorIds: string[]; ids: string[]; unread: boolean }

export default function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [data, setData] = useState<NotificationCenter | null>(null)
  const [ctx, setCtx] = useState<RenderContext>(EMPTY_CTX)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    if (!user) return
    const [next, unread] = await Promise.all([
      getNotificationCenter(user.id),
      getNotificationUnreadCounts().catch(() => ({}) as Record<string, number>),
    ])
    setData(next)
    setCounts(unread)

    const notifications = next.updates
      .filter((u) => u.kind === 'notification')
      .map((u) => (u as Extract<UpdateItem, { kind: 'notification' }>).notification)
    if (notifications.length) setCtx(await getNotificationContext(notifications, user.id))
  }, [user])

  useEffect(() => {
    load().catch((err) => {
      console.error('[beatboxed] notifications failed:', err)
      setData({ requests: [], updates: [], badge: 0 })
    })
  }, [load])

  async function markRead(d: Display) {
    try {
      if (d.item.kind === 'notification') await Promise.all(d.ids.map((id) => markNotificationRead(id)))
      else if (user) await markAnnouncementRead(d.item.announcement.id, user.id)
    } catch (err) {
      console.warn('[beatboxed] mark read failed:', err)
    }
  }

  async function openItem(d: Display, rendered: RenderedNotification, reply = false) {
    await markRead(d)
    await load().catch(() => {})
    if (!rendered.href) return
    if (rendered.href.startsWith('/')) navigate(rendered.href + (reply ? '&reply=1' : ''))
    else window.open(rendered.href, '_blank', 'noopener,noreferrer')
  }

  async function likeComment(commentId: string) {
    if (!user) return
    const current = ctx.comments.get(commentId)
    if (!current) return
    const next = !current.likedByMe
    const set = (liked: boolean) =>
      setCtx((c) => {
        const comments = new Map(c.comments)
        const was = comments.get(commentId)
        if (was) comments.set(commentId, { ...was, likedByMe: liked })
        return { ...c, comments }
      })
    set(next)
    try {
      await setCommentLike(commentId, user.id, next)
    } catch (err) {
      console.error('[beatboxed] comment like failed:', err)
      set(!next)
      toast.show({ message: "Couldn't save that like. Try again." })
    }
  }

  async function handleMarkAll() {
    if (!user || !data) return
    try {
      await markAllRead(user.id, data.updates)
      await load()
    } catch (err) {
      console.error('[beatboxed] mark all read failed:', err)
    }
  }

  function categoryOf(item: UpdateItem): NotificationCategory | null {
    if (item.kind === 'announcement') return 'beatboxed'
    return NOTIFICATION_CATEGORIES[item.notification.type] ?? null
  }

  const filtered = (data?.updates ?? []).filter((u) => filter === 'all' || categoryOf(u) === filter)

  /**
   * Several likes on the same review, or the same comment, show as one row
   * — "ory and 2 others" — with the newest actor's avatar. The table keeps a
   * row per like so unread state and undo stay per person; the database's
   * group_key says which belong together.
   */
  const visible: Display[] = []
  const byGroup = new Map<string, Display>()
  for (const u of filtered) {
    const unread = u.kind === 'notification' ? !u.notification.read : !u.announcement.read
    const id = u.kind === 'notification' ? u.notification.id : u.announcement.id
    const group = u.kind === 'notification' ? u.notification.groupKey : null
    if (group) {
      const existing = byGroup.get(group)
      if (existing && u.kind === 'notification') {
        const actor = u.notification.payload.actor_id
        if (typeof actor === 'string') existing.alsoActorIds.push(actor)
        existing.ids.push(id)
        // An unread like keeps the whole group unread.
        existing.unread ||= unread
        continue
      }
      const row: Display = { item: u, alsoActorIds: [], ids: [id], unread }
      byGroup.set(group, row)
      visible.push(row)
      continue
    }
    visible.push({ item: u, alsoActorIds: [], ids: [id], unread })
  }

  const hasUnread = (data?.updates ?? []).some((u) =>
    u.kind === 'notification' ? !u.notification.read : !u.announcement.read
  )

  // Unread counts per chip, from the database; announcements are added here.
  const unreadAnnouncements = (data?.updates ?? []).filter(
    (u) => u.kind === 'announcement' && !u.announcement.read
  ).length
  const chipCount = (f: Filter) =>
    f === 'beatboxed'
      ? unreadAnnouncements
      : f === 'all'
        ? (counts.all ?? 0) + unreadAnnouncements
        : (counts[f] ?? 0)

  const requests = data?.requests ?? []
  const requestNames = requests
    .map((r) => r.person.displayName || r.person.username || 'Someone')
    .filter(Boolean)
  const requestLine =
    requests.length === 1
      ? `${requestNames[0]} wants to follow you`
      : requests.length === 2
        ? `${requestNames[0]} and ${requestNames[1]} want to follow you`
        : `${requestNames[0]} and ${requests.length - 1} others want to follow you`

  // New is unread, Earlier is read. An empty group prints no heading.
  const groups = (
    [
      ['New', visible.filter((d) => d.unread)],
      ['Earlier', visible.filter((d) => !d.unread)],
    ] as [string, Display[]][]
  ).filter(([, items]) => items.length > 0)

  const emptyText = FILTERS.find((f) => f.value === filter)?.empty ?? ''

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pt-2">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-page-title">Notifications</h1>
        {hasUnread && (
          <button
            type="button"
            onClick={() => void handleMarkAll()}
            className="min-h-11 shrink-0 rounded-chip bg-surface-2 px-4 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            Mark all read
          </button>
        )}
      </div>

      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
        role="group"
        aria-label="Filter notifications"
      >
        {FILTERS.map((f) => {
          const n = chipCount(f.value)
          return (
            <Chip key={f.value} solid active={filter === f.value} onClick={() => setFilter(f.value)}>
              <span className="flex items-center gap-2">
                {f.label}
                {n > 0 && (
                  <span
                    aria-label={`${n} unread`}
                    className="grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-meta font-semibold leading-none text-white"
                  >
                    {n}
                  </span>
                )}
              </span>
            </Chip>
          )
        })}
      </div>

      {requests.length > 0 && (filter === 'all' || filter === 'follows') && (
        <Link
          to="/notifications/requests"
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
        >
          <span className="flex shrink-0 -space-x-3">
            {requests.slice(0, 3).map((r) => {
              const name = r.person.displayName || r.person.username || '?'
              return r.person.avatarUrl ? (
                <img
                  key={r.person.id}
                  src={r.person.avatarUrl}
                  alt=""
                  className="size-10 rounded-full border-2 border-surface object-cover"
                />
              ) : (
                <span
                  key={r.person.id}
                  className="grid size-10 place-items-center rounded-full border-2 border-surface bg-surface-2 text-card-title text-muted-foreground"
                >
                  {name.charAt(0).toUpperCase()}
                </span>
              )
            })}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <Users className="size-4 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-card-title">Follow requests</span>
            </span>
            <span dir="auto" className="truncate text-secondary text-muted-foreground">
              {requestLine}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-meta text-white">
              {requests.length}
            </span>
            <ChevronRight className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
        </Link>
      )}

      {!data ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <SkeletonList rows={5} cover="size-11 rounded-full" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          face="sleepy-sticker"
          title={filter === 'all' ? "You're all caught up." : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} yet`}
          detail={emptyText}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([heading, items]) => (
            <section key={heading} className="flex flex-col gap-2" aria-labelledby={`notif-${heading}`}>
              <h2
                id={`notif-${heading}`}
                className="px-1 text-meta font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {heading}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {items.map((d) => {
                  const { item, alsoActorIds } = d
                  const rendered =
                    item.kind === 'announcement'
                      ? renderAnnouncement(item.announcement)
                      : (NOTIFICATION_RENDERERS[item.notification.type]?.(item.notification, ctx, alsoActorIds) ??
                        null)
                  // Unknown type, or a payload no renderer can use.
                  if (!rendered) return null
                  const key = d.ids[0]
                  const liked = rendered.commentId ? ctx.comments.get(rendered.commentId)?.likedByMe : false
                  const commentExists = rendered.commentId ? ctx.comments.has(rendered.commentId) : false

                  return (
                    <li
                      key={key}
                      data-notification-type={item.kind === 'notification' ? item.notification.type : 'announcement'}
                      className={cn(
                        'flex items-start gap-3 rounded-card p-4 transition-colors duration-200 ease-soft',
                        d.unread ? 'bg-surface' : 'hover:bg-surface/60'
                      )}
                    >
                      {/* The avatar opens the actor's profile; the rest of
                          the row opens whatever it's about. */}
                      {rendered.actorId ? (
                        <Link
                          to={`/profile/${rendered.actorId}`}
                          aria-hidden
                          tabIndex={-1}
                          className="shrink-0 transition-opacity duration-200 hover:opacity-80"
                        >
                          {rendered.avatar}
                        </Link>
                      ) : (
                        rendered.avatar
                      )}

                      <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => void openItem(d, rendered)}
                          className="flex w-full items-start gap-3 text-left"
                        >
                          <span className="min-w-0 flex-1 text-body text-muted-foreground">
                            {rendered.body}
                            <span className="whitespace-nowrap"> · {shortAgo(item.at)}</span>
                          </span>
                          {d.unread && (
                            <span aria-label="Unread" className="mt-2 size-2.5 shrink-0 rounded-full bg-accent" />
                          )}
                        </button>
                        {rendered.quote && (
                          <p
                            dir="auto"
                            className="max-w-full rounded-[16px] bg-surface-2 px-3.5 py-2 text-body text-foreground line-clamp-3"
                          >
                            {rendered.quote}
                          </p>
                        )}
                        {rendered.commentId && commentExists && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void openItem(d, rendered, true)}
                              className="min-h-11 rounded-chip bg-primary/25 px-5 text-button text-accent transition-colors duration-200 ease-soft hover:bg-primary/35"
                            >
                              Reply
                            </button>
                            <button
                              type="button"
                              onClick={() => void likeComment(rendered.commentId!)}
                              aria-pressed={!!liked}
                              aria-label={liked ? 'Unlike this comment' : 'Like this comment'}
                              className={cn(
                                'grid size-11 place-items-center rounded-full transition-colors duration-200 ease-soft',
                                liked ? 'bg-like/15 text-like' : 'bg-surface-2 text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <Heart className={cn('size-[18px]', liked && 'fill-like')} strokeWidth={1.75} />
                            </button>
                          </div>
                        )}
                      </div>

                      {rendered.coverUrl && (
                        <img
                          src={rendered.coverUrl}
                          alt=""
                          className="size-14 shrink-0 rounded-inset object-cover"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
