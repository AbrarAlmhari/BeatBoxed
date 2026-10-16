import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-2.5', // list rows
  md: 'p-4', // content cards
  lg: 'px-6 py-10', // empty and lock states
}

/**
 * The card look as a class string, for elements that can't be a <Card>
 * (a router Link, a button). Surface, 1px subtle border, 18px corners.
 */
export function cardClass({
  padding = 'md',
  interactive = false,
  shadow = true,
}: { padding?: CardPadding; interactive?: boolean; shadow?: boolean } = {}) {
  return cn(
    'rounded-card border border-line bg-surface',
    shadow && 'shadow-card',
    PADDING[padding],
    interactive && 'transition-colors duration-200 ease-soft hover:bg-surface-2'
  )
}

/**
 * A card: the surface everything on a page sits on.
 *
 * `as` keeps the right element for the content (an article for a review, a
 * li in a list), `interactive` adds the hover for cards that are links.
 */
export function Card({
  as: Tag = 'div',
  padding = 'md',
  interactive = false,
  shadow = true,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li' | 'ul' | 'ol' | 'aside'
  padding?: CardPadding
  interactive?: boolean
  shadow?: boolean
}) {
  return <Tag className={cn(cardClass({ padding, interactive, shadow }), className)} {...rest} />
}
