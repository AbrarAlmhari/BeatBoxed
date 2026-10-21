import { Link } from 'react-router-dom'
import { commentSegments, type MentionPerson } from '@/lib/conversations'
import { cn } from '@/lib/cn'

/**
 * A comment's words, with mentions as purple chips that open the person's
 * profile. dir="auto" lets Arabic run right to left inside its bubble
 * without pushing the bubble to the far side of the card, and (index.css)
 * wraps a long word inside the bubble.
 */
export function CommentText({
  body,
  mentions,
  className,
}: {
  body: string
  mentions: MentionPerson[]
  className?: string
}) {
  return (
    <p dir="auto" className={cn('max-w-full whitespace-pre-line', className)}>
      {commentSegments(body, mentions).map((s, i) =>
        s.kind === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <Link
            key={i}
            to={`/profile/${s.person.id}`}
            dir="ltr"
            className="mx-px inline-block rounded-md bg-primary/25 px-1.5 font-semibold text-accent transition-colors duration-200 ease-soft hover:bg-primary/40"
          >
            @{s.person.username}
          </Link>
        )
      )}
    </p>
  )
}
