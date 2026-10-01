import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCheck, Loader2, X } from 'lucide-react'
import { FriendButton } from '@/components/people/FriendButton'
import {
  NOTIFICATION_RENDERERS,
  referencedPersonIds,
  renderAnnouncement,
  type RenderedNotification,
} from './renderers'
import {
  getNotificationCenter,
  getPeopleByIds,
  markAllRead,
  markAnnouncementRead,
  markNotificationRead,
} from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type {
  NotificationCenter,
  PersonCardModel,
  UpdateItem,
} from '@/lib/types'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const STEPS: [number, Intl.RelativeTimeFormatUnit, number][] = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
  [2629800, 'week', 604800],
  [31557600, 'month', 2629800],
]
function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  for (const [limit, unit, per] of STEPS) {
    if (s < limit) return relative.format(-Math.round(s / per), unit)
  }
  return relative.format(-Math.round(s / 31557600), 'year')
}

export function NotificationPanel({
  viewerId,
  onClose,
  onDataChange,
}: {
  viewerId: string
  onClose: () => void
  onDataChange: (data: NotificationCenter) => void
}) {
  const navigate = useNavigate()
  const [data, setData] = useState<NotificationCenter | null>(null)
  const [people, setPeople] = useState<Map<string, PersonCardModel>>(new Map())

  async function load() {
    const next = await getNotificationCenter(viewerId)
    setData(next)
    onDataChange(next)

    // Resolve the people every renderer references, in one query.
    const ids = [
      ...new Set(
        next.updates.flatMap((u) =>
          u.kind === 'notification' ? referencedPersonIds(u.notification) : []
        )
      ),
    ]
    if (ids.length) setPeople(await getPeopleByIds(ids))
  }

  // Re-fetch every time the panel opens, per the refresh rule.
  useEffect(() => {
    load().catch((err) => {
      console.error('[beatboxed] notifications failed:', err)
      setData({ requests: [], updates: [], badge: 0 })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId])

  async function openItem(item: UpdateItem, rendered: RenderedNotification) {
    try {
      if (item.kind === 'notification') await markNotificationRead(item.notification.id)
      else await markAnnouncementRead(item.announcement.id, viewerId)
    } catch (err) {
      console.warn('[beatboxed] mark read failed:', err)
    }
    await load().catch(() => {})

    if (!rendered.href) return
    onClose()
    if (rendered.href.startsWith('/')) navigate(rendered.href)
    else window.open(rendered.href, '_blank', 'noopener,noreferrer')
  }

  async function handleMarkAll() {
    if (!data) return
    try {
      await markAllRead(viewerId, data.updates)
      await load()
    } catch (err) {
      console.error('[beatboxed] mark all read failed:', err)
    }
  }

  const hasUnread = data?.updates.some((u) =>
    u.kind === 'notification' ? !u.notification.read : !u.announcement.read
  )

  return (
    <div className="flex max-h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
        <h2 className="text-section-title">Notifications</h2>
        <div className="flex items-center gap-1">
          {hasUnread && (
            <button
              type="button"
              onClick={handleMarkAll}
              className="flex items-center gap-1.5 rounded-button px-2 py-1 text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
            >
              <CheckCheck className="size-3.5" strokeWidth={2} />
              Mark all as read
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!data ? (
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h3 className="text-card-title">
                Requests
                {data.requests.length > 0 && (
                  <span className="text-secondary text-muted-foreground">
                    {' '}
                    ({data.requests.length})
                  </span>
                )}
              </h3>

              {data.requests.length === 0 ? (
                <p className="text-secondary text-muted-foreground">
                  No pending friend requests.
                </p>
              ) : (
                data.requests.map((edge) => {
                  const name =
                    edge.person.displayName || edge.person.username || 'Listener'
                  return (
                    <div
                      key={edge.person.id}
                      className="flex items-center gap-3 rounded-card bg-surface p-3"
                    >
                      <Link to={`/profile/${edge.person.id}`} onClick={onClose}>
                        {edge.person.avatarUrl ? (
                          <img
                            src={edge.person.avatarUrl}
                            alt=""
                            className="size-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
                            {name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </Link>
                      <Link
                        to={`/profile/${edge.person.id}`}
                        onClick={onClose}
                        className="flex min-w-0 flex-1 flex-col"
                      >
                        <span dir="auto" className="truncate text-card-title">
                          {name}
                        </span>
                        {edge.person.username && (
                          <span className="truncate text-meta text-muted-foreground">
                            @{edge.person.username}
                          </span>
                        )}
                      </Link>
                      {/* Same component as profiles and search, so Accept and
                          Decline behave identically everywhere. */}
                      <FriendButton
                        personId={edge.person.id}
                        state="incoming"
                        size="sm"
                        onChange={() => void load()}
                      />
                    </div>
                  )
                })
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-card-title">Updates</h3>

              {data.updates.length === 0 ? (
                <p className="text-secondary text-muted-foreground">
                  Nothing new yet.
                </p>
              ) : (
                data.updates.map((item) => {
                  const rendered =
                    item.kind === 'announcement'
                      ? renderAnnouncement(item.announcement)
                      : NOTIFICATION_RENDERERS[item.notification.type]?.(
                          item.notification,
                          people
                        ) ?? null

                  // Unknown type, or a payload the renderer can't use.
                  if (!rendered) return null

                  const unread =
                    item.kind === 'notification'
                      ? !item.notification.read
                      : !item.announcement.read
                  const key =
                    item.kind === 'notification'
                      ? item.notification.id
                      : item.announcement.id

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void openItem(item, rendered)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-card p-3 text-left transition-colors duration-200 ease-soft',
                        unread ? 'bg-primary/10 hover:bg-primary/15' : 'bg-surface hover:bg-surface-2'
                      )}
                    >
                      <span className="mt-0.5 shrink-0">{rendered.icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-secondary">{rendered.body}</span>
                        <span className="text-meta text-muted-foreground">
                          {timeAgo(item.at)}
                        </span>
                      </span>
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </button>
                  )
                })
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
