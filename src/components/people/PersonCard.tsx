import { Link } from 'react-router-dom'
import { FriendButton } from './FriendButton'
import type { FriendState, PersonCardModel } from '@/lib/types'

export function PersonCard({
  person,
  state,
  onStateChange,
  showAction = true,
}: {
  person: PersonCardModel
  state: FriendState
  onStateChange?: (next: FriendState) => void
  showAction?: boolean
}) {
  const name = person.displayName || person.username || 'Listener'

  return (
    <Link
      to={`/profile/${person.id}`}
      className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-card-title text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-card-title">
          {name}
        </span>
        {person.username && (
          <span className="truncate text-secondary text-muted-foreground">
            @{person.username}
          </span>
        )}
      </span>

      {showAction && (
        <FriendButton
          personId={person.id}
          state={state}
          onChange={onStateChange}
          size="sm"
        />
      )}
    </Link>
  )
}
