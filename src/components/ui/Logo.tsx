import full from '@/assets/logo-full.png'
import icon from '@/assets/beatboxed-icon.png'
import { cn } from '@/lib/cn'

/**
 * Glow presets. drop-shadow follows the PNG's alpha shape, so the bloom hugs
 * the letterforms instead of sitting behind a rectangle — but the blur radii
 * are absolute pixels, so they have to scale with how big the mark renders or
 * a large-logo tuning turns to mush at icon size.
 *
 * Inner layers use Primary, the outer falloff Accent (theme tokens), per
 * docs/design-system.md. Opacities stay in the 0.15–0.35 band the doc allows.
 */
const primary = (pct: number) => `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`
const accent = (pct: number) => `color-mix(in srgb, var(--color-accent) ${pct}%, transparent)`

const GLOW = {
  /** ~260–288px wide — the auth page wordmark. */
  lg: `drop-shadow(0 0 8px ${primary(35)})
       drop-shadow(0 0 24px ${primary(25)})
       drop-shadow(0 0 56px ${accent(15)})`,
  /** ~120–150px wide — sidebar and top-bar wordmarks. */
  md: `drop-shadow(0 0 4px ${primary(35)})
       drop-shadow(0 0 12px ${primary(25)})
       drop-shadow(0 0 28px ${accent(15)})`,
  /** ~36–40px — the standalone boombox mark. */
  sm: `drop-shadow(0 0 3px ${primary(35)})
       drop-shadow(0 0 8px ${primary(25)})
       drop-shadow(0 0 18px ${accent(15)})`,
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
