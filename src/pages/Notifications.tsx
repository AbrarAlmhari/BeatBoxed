import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCheck, ChevronRight, Loader2, Users } from 'lucide-react'
import { BackButton } from '@/components/ui/BackButton'
import { Chip } from '@/components/ui/Chip'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_RENDERERS,
  referencedPersonIds,
  renderAnnouncement,
  type NotificationCategory,
  type RenderedNotification,
} from '@/components/notifications/renderers'
import { useAuth } from '@/lib/auth'
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

type Filter = 'all' | NotificationCategory

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'friends', label: 'Friends' },
  { value: 'artists', label: 'Artists' },
  { value: 'beatboxed', label: 'Beatboxed' },
]

/** Compact "2h" style rather than "2 hours ago" — these sit in a dense list. */
function shortAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / 604800)}w`
}

type Bucket = 'Today' | 'This week' | 'Earlier'

function bucketFor(iso: string): Bucket {
  const age = (Date.now() - new Date(iso).getTime()) / 1000
  if (age < 86400) return 'Today'
  if (age < 604800) return 'This week'
  return 'Earlier'
}

export default function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [data, setData] = useState<NotificationCenter | null>(null)
  const [people, setPeople] = useState<Map<string, PersonCardModel>>(new Map())
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    if (!user) return
    const next = await getNotificationCenter(user.id)
    setData(next)

    const ids = [
      ...new Set(
        next.updates.flatMap((u) =>
          u.kind === 'notification' ? referencedPersonIds(u.notification) : []
        )
      ),
    ]
    if (ids.length) setPeople(await getPeopleByIds(ids))
  }, [user])

  useEffect(() => {
    load().catch((err) => {
      console.error('[beatboxed] notifications failed:', err)
      setData({ requests: [], updates: [], badge: 0 })
    })
  }, [load])

  async function openItem(item: UpdateItem, rendered: RenderedNotification) {
    try {
      if (item.kind === 'notification') await markNotificationRead(item.notification.id)
      else if (user) await markAnnouncementRead(item.announcement.id, user.id)
    } catch (err) {
      console.warn('[beatboxed] mark read failed:', err)
    }
    await load().catch(() => {})

    if (!rendered.href) return
    if (rendered.href.startsWith('/')) navigate(rendered.href)
    else window.open(rendered.href, '_blank', 'noopener,noreferrer')
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

  /** Category of an item, for the filter chips. */
  function categoryOf(item: UpdateItem): NotificationCategory | null {
    if (item.kind === 'announcement') return 'beatboxed'
    return NOTIFICATION_CATEGORIES[item.notification.type] ?? null
  }

  const visible = (data?.updates ?? []).filter(
    (u) => filter === 'all' || categoryOf(u) === filter
  )

  const hasUnread = (data?.updates ?? []).some((u) =>
    u.kind === 'notification' ? !u.notification.read : !u.announcement.read
  )

  const requests = data?.requests ?? []
  const requestNames = requests
    .map((r) => r.person.displayName || r.person.username || 'Someone')
    .filter(Boolean)

  const requestLine =
    requests.length === 1
      ? `${requestNames[0]} wants to be friends`
      : requests.length === 2
        ? `${requestNames[0]} and ${requestNames[1]} want to be friends`
        : `${requestNames[0]} and ${requests.length - 1} others want to be friends`

  // Group after filtering, so an empty bucket never prints a heading.
  const groups: [Bucket, UpdateItem[]][] = (
    ['Today', 'This week', 'Earlier'] as Bucket[]
  )
    .map((b): [Bucket, UpdateItem[]] => [
      b,
      visible.filter((u) => bucketFor(u.at) === b),
    ])
    .filter(([, items]) => items.length > 0)

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex items-center gap-2">
        <BackButton className="-ml-2" />
        <h1 className="flex-1 text-page-title">Notifications</h1>
        {hasUnread && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="flex shrink-0 items-center gap-1.5 rounded-button px-2.5 py-1.5 text-meta text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
          >
            <CheckCheck className="size-3.5" strokeWidth={2} />
            Mark all as read
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <Link
          to="/notifications/requests"
          className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
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
              <span className="text-card-title">Friend requests</span>
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

      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        role="group"
        aria-label="Filter notifications"
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            active={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {!data ? (
        <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          Loading…
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-card-title">You're all caught up.</p>
          <p className="max-w-sm text-body text-muted-foreground">
            {filter === 'all'
              ? 'New activity will show up here.'
              : 'Nothing under this filter yet.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([bucket, items]) => (
            <section key={bucket} className="flex flex-col gap-2">
              <h2 className="text-meta text-muted-foreground">{bucket}</h2>
              {items.map((item) => {
                const rendered =
                  item.kind === 'announcement'
                    ? renderAnnouncement(item.announcement)
                    : NOTIFICATION_RENDERERS[item.notification.type]?.(
                        item.notification,
                        people
                      ) ?? null

                // Unknown type, or a payload no renderer can use.
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
                      'flex w-full items-start gap-3 rounded-card p-4 text-left shadow-card transition-colors duration-200 ease-soft',
                      unread
                        ? 'bg-primary/10 hover:bg-primary/15'
                        : 'bg-surface hover:bg-surface-2'
                    )}
                  >
                    <span className="mt-0.5 shrink-0">{rendered.icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-secondary">{rendered.body}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-meta text-muted-foreground">
                        {shortAgo(item.at)}
                      </span>
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="size-2 rounded-full bg-primary"
                        />
                      )}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
