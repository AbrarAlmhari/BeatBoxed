import defaultSrc from '@/assets/beatie/svg/beatie-default.svg'
import happySrc from '@/assets/beatie/svg/beatie-happy.svg'
import thinkingSrc from '@/assets/beatie/svg/beatie-thinking.svg'
import excitedSrc from '@/assets/beatie/svg/beatie-excited.svg'
import sleepySrc from '@/assets/beatie/svg/beatie-sleepy.svg'
import sadSrc from '@/assets/beatie/svg/beatie-sad.svg'
import markSrc from '@/assets/beatie/svg/beatie-mark.svg'
import { cn } from '@/lib/cn'

/**
 * Beatie's face, from the character pack in src/assets/beatie/ (see its
 * README). The SVGs are used as image files, never inlined: each one uses
 * the same internal gradient names, so inline copies on one page would
 * clash. They're never recoloured or redrawn.
 *
 *   default   normal look: Song page card, Ask Beatie sheet
 *   happy     an answer has arrived
 *   thinking  a request is running (with a gentle bob)
 *   excited   the one-time hello bubble
 *   sleepy    "taking a break" and the daily limit
 *   sad       other errors, and no lyrics found
 *   mark      small sizes (16–40px): the Ask Beatie pill, chat avatars,
 *             icons inside buttons
 *
 * Minimum sizes from the README: 16px for the mark, 48px for the rest.
 */
export type BeatieMood = 'default' | 'happy' | 'thinking' | 'excited' | 'sleepy' | 'sad'

const SOURCES: Record<BeatieMood | 'mark', string> = {
  default: defaultSrc,
  happy: happySrc,
  thinking: thinkingSrc,
  excited: excitedSrc,
  sleepy: sleepySrc,
  sad: sadSrc,
  mark: markSrc,
}

export function BeatieImage({
  mood,
  size,
  alt = '',
  className,
}: {
  mood: BeatieMood | 'mark'
  /** In pixels. Kept at or above the README's minimum for the file. */
  size: number
  /** '' when the words beside it already say "Beatie". */
  alt?: string
  className?: string
}) {
  const min = mood === 'mark' ? 16 : 48
  const px = Math.max(size, min)
  return (
    <img
      src={SOURCES[mood]}
      alt={alt}
      width={px}
      height={px}
      draggable={false}
      className={cn(
        'shrink-0 select-none object-contain',
        // A small bob while thinking, and only then; none with reduced motion.
        mood === 'thinking' && 'animate-beatie-bob motion-reduce:animate-none',
        className
      )}
      style={{ width: px, height: px }}
    />
  )
}
