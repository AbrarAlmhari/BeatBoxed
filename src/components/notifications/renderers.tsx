import { Megaphone, UserCheck } from 'lucide-react'
import type { Announcement, NotificationRow, PersonCardModel } from '@/lib/types'

export type RenderedNotification = {
  icon: React.ReactNode
  body: React.ReactNode
  /** Where clicking takes you, or null to stay put. */
  href: string | null
}

/**
 * type -> renderer. Adding review_liked or artist_release later means a new
 * trigger plus one entry here; nothing else changes.
 *
 * A type with no entry renders nothing rather than throwing, so a trigger can
 * ship before the UI that understands it.
 */
export type NotificationRenderer = (
  n: NotificationRow,
  people: Map<string, PersonCardModel>
) => RenderedNotification | null

const friendAccepted: NotificationRenderer = (n, people) => {
  const id = typeof n.payload.friend_id === 'string' ? n.payload.friend_id : null
  if (!id) return null

  // Payloads hold ids only, so the name is always whatever it is right now.
  const person = people.get(id)
  const name = person?.displayName || person?.username || 'Someone'

  return {
    icon: <UserCheck className="size-4 text-primary" strokeWidth={2} />,
    body: (
      <>
        <span className="text-foreground">{name}</span>
        <span className="text-muted-foreground"> accepted your friend request.</span>
      </>
    ),
    href: `/profile/${id}`,
  }
}

export const NOTIFICATION_RENDERERS: Record<string, NotificationRenderer> = {
  friend_accepted: friendAccepted,
}

/** Ids a notification needs resolved before it can render. */
export function referencedPersonIds(n: NotificationRow): string[] {
  const id = n.payload.friend_id
  return typeof id === 'string' ? [id] : []
}

export function renderAnnouncement(a: Announcement): RenderedNotification {
  return {
    icon: <Megaphone className="size-4 text-primary" strokeWidth={2} />,
    body: (
      <>
        <span className="text-foreground">{a.title}</span>
        <span className="block text-muted-foreground">{a.body}</span>
      </>
    ),
    href: a.link,
  }
}
