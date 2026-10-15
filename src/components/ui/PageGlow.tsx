import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

export type GlowStrength = 'hero' | 'soft' | 'none'

/** Opacity of each colour, per strength. Hero matches the profile header. */
const ALPHA: Record<Exclude<GlowStrength, 'none'>, [number, number]> = {
  hero: [35, 14],
  soft: [16, 7],
}

/**
 * Defaults per strength. The pink only works at hero strength: as a faint
 * wash it reads as a reddish smudge, so soft glows pair Primary with Accent.
 */
const DEFAULT_COLORS: Record<Exclude<GlowStrength, 'none'>, [string, string]> = {
  hero: ['var(--color-glow-1)', 'var(--color-glow-2)'],
  soft: ['var(--color-glow-1)', 'var(--color-accent)'],
}

const FADE_OUT = 'linear-gradient(to bottom, black 55%, transparent)'

function gradient([a, b]: [string, string], strength: Exclude<GlowStrength, 'none'>) {
  const [aa, ba] = ALPHA[strength]
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
  return (
    `radial-gradient(60% 60% at 30% 40%, ${mix(a, aa)}, transparent 70%), ` +
    `radial-gradient(40% 50% at 85% 20%, ${mix(b, ba)}, transparent 70%)`
  )
}

/**
 * The soft light behind the top of a page: two layered radial gradients
 * that fade out downwards. Gradients rather than a blur filter, so
 * scrolling stays smooth on cheaper phones.
 *
 * Decoration only: aria-hidden, no pointer events, absolutely positioned
 * behind its parent's content (the parent needs `relative isolate`). It
 * scrolls away with the page.
 *
 * - `hero` fills its parent (a page header) and bleeds past the page's side
 *   padding and up under the top bar.
 * - `soft` is a fainter wash over the top 420px of the page.
 * - `none` renders nothing.
 *
 * `colors` are two opaque colours (any CSS colour, defaulting to Primary
 * with pink for hero, Primary with Accent for soft); the strength sets their
 * opacity. When they change, the new glow fades in over the old one (600ms;
 * instant with reduced motion).
 */
export function PageGlow({
  strength = 'soft',
  colors: given,
  className,
}: {
  strength?: GlowStrength
  colors?: [string, string]
  className?: string
}) {
  const colors = given ?? DEFAULT_COLORS[strength === 'none' ? 'soft' : strength]
  const key = colors.join('|')
  // Earlier layers stay underneath until the newest has faded in.
  const [layers, setLayers] = useState([{ key, colors }])
  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1].key === key) return prev
      // No fade with reduced motion: swap straight to the new colours.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return [{ key, colors }]
      return [...prev.filter((l) => l.key !== key), { key, colors }]
    })
    // key covers colors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (strength === 'none') return null

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute -inset-x-4 -top-24 -z-10 sm:-inset-x-6 lg:-inset-x-8',
        strength === 'hero' ? 'bottom-0' : 'h-[420px]',
        className
      )}
      style={{ maskImage: FADE_OUT, WebkitMaskImage: FADE_OUT }}
    >
      {layers.map((layer, i) => (
        <div
          key={layer.key}
          className={cn('absolute inset-0', i > 0 && 'animate-glow-in motion-reduce:animate-none')}
          style={{ background: gradient(layer.colors, strength) }}
          onAnimationEnd={() => setLayers((prev) => prev.slice(prev.findIndex((l) => l.key === layer.key)))}
        />
      ))}
    </div>
  )
}
