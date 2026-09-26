import full from '@/assets/logo-full.png'
import icon from '@/assets/beatboxed-icon.png'
import { cn } from '@/lib/cn'

/**
 * Glow presets. drop-shadow follows the PNG's alpha shape, so the bloom hugs
 * the letterforms instead of sitting behind a rectangle — but the blur radii
 * are absolute pixels, so they have to scale with how big the mark renders or
 * a large-logo tuning turns to mush at icon size.
 *
 * Inner layers use Primary #8B5CF6, the outer falloff Accent #C084FC, per
 * docs/design-system.md. Opacities stay in the 0.15–0.35 band the doc allows.
 */
const GLOW = {
  /** ~260–288px wide — the auth page wordmark. */
  lg: `drop-shadow(0 0 8px rgba(139, 92, 246, 0.35))
       drop-shadow(0 0 24px rgba(139, 92, 246, 0.25))
       drop-shadow(0 0 56px rgba(192, 132, 252, 0.15))`,
  /** ~120–150px wide — sidebar and top-bar wordmarks. */
  md: `drop-shadow(0 0 4px rgba(139, 92, 246, 0.35))
       drop-shadow(0 0 12px rgba(139, 92, 246, 0.25))
       drop-shadow(0 0 28px rgba(192, 132, 252, 0.15))`,
  /** ~36–40px — the standalone boombox mark. */
  sm: `drop-shadow(0 0 3px rgba(139, 92, 246, 0.35))
       drop-shadow(0 0 8px rgba(139, 92, 246, 0.25))
       drop-shadow(0 0 18px rgba(192, 132, 252, 0.15))`,
} as const

export function Logo({
  variant,
  glow,
  className,
}: {
  variant: 'full' | 'icon'
  /** Size bucket to tune blur radii against; omit for no glow. */
  glow?: keyof typeof GLOW
  className?: string
}) {
  return (
    <img
      src={variant === 'full' ? full : icon}
      alt="Beatboxed"
      draggable={false}
      style={glow ? { filter: GLOW[glow] } : undefined}
      className={cn('object-contain', className)}
    />
  )
}
