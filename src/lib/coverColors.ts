import { useEffect, useState } from 'react'

/**
 * The two main colours of a cover or artist photo, for the page's glow.
 *
 * Read in the browser from a 32×32 copy of the image. The images are on
 * i.scdn.co and Supabase storage, which both send
 * Access-Control-Allow-Origin: *, so the canvas isn't tainted. Anything that
 * fails (no URL, a host without CORS, a blank image) gives null, and the
 * page keeps the default purple glow.
 *
 * Each colour is darkened until, at the glow's strongest (35% over the page
 * background), muted text on it still reads at 4.5:1, so white text does
 * too, by a wide margin.
 *
 * Results are kept in memory per URL for the session: going back to a page
 * doesn't read the image again.
 */
export type CoverColors = [string, string]

/**
 * The glow for a cover page until the colours are known, or when a cover
 * has too little colour to read (a black-and-white photo): Primary and
 * Accent, the purple fallback.
 */
export const COVER_FALLBACK: CoverColors = ['var(--color-glow-1)', 'var(--color-accent)']

const cache = new Map<string, Promise<CoverColors | null>>()

/** The colours for a URL, from the cache when they've been worked out. */
export function getCoverColors(url: string): Promise<CoverColors | null> {
  let hit = cache.get(url)
  if (!hit) {
    hit = extract(url).catch(() => null)
    cache.set(url, hit)
  }
  return hit
}

/** For a page: null until known (or when the image can't be read). */
export function useCoverColors(url: string | null | undefined): CoverColors | null {
  const [colors, setColors] = useState<{ url: string; colors: CoverColors | null } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    void getCoverColors(url).then((c) => {
      if (live) setColors({ url, colors: c })
    })
    return () => {
      live = false
    }
  }, [url])
  // Never hand back the last page's colours while the new ones load.
  return colors && colors.url === url ? colors.colors : null
}

const SIZE = 32
const BACKGROUND: RGB = [13, 13, 18] // --color-background
const MUTED: RGB = [161, 161, 170] // --color-muted-foreground
const GLOW_ALPHA = 0.35 // PageGlow's hero strength, the strongest
const MIN_CONTRAST = 4.5

type RGB = [number, number, number]

function extract(url: string): Promise<CoverColors | null> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        resolve(pickColors(ctx.getImageData(0, 0, SIZE, SIZE).data))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('cover failed to load'))
    img.src = url
  })
}

/**
 * Buckets the pixels by hue (12 buckets) and weighs each by how colourful
 * it is, so a big grey background doesn't win over a red logo. The first
 * colour is the heaviest bucket, the second the heaviest one at least two
 * buckets away in hue (or the first again, for a one-colour cover).
 */
function pickColors(data: Uint8ClampedArray): CoverColors | null {
  const buckets = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = (max - min) / 255
    if (chroma < 0.12 || max < 40) continue // greys, near-black
    const bucket = buckets[Math.floor(hue(r, g, b, max, min) / 30) % 12]
    const w = chroma * chroma
    bucket.weight += w
    bucket.r += r * w
    bucket.g += g * w
    bucket.b += b * w
  }
  const ranked = buckets
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.weight > 0)
    .sort((a, b) => b.weight - a.weight)
  // Too little colour to call it (a black-and-white photo): keep the default.
  const total = ranked.reduce((sum, b) => sum + b.weight, 0)
  if (!ranked.length || total < SIZE * SIZE * 0.01) return null

  const first = ranked[0]
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b)) >= 2
  const second = ranked.find((b) => apart(b.i, first.i) && b.weight > first.weight * 0.15) ?? first
  const avg = (b: (typeof ranked)[number]): RGB => [b.r / b.weight, b.g / b.weight, b.b / b.weight]
  return [toCss(safe(avg(first))), toCss(safe(avg(second)))]
}

function hue(r: number, g: number, b: number, max: number, min: number) {
  const d = max - min
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Darkens a colour until muted text over the glow keeps 4.5:1. */
function safe(c: RGB): RGB {
  let out = c
  for (let k = 1; k > 0.05; k -= 0.05) {
    out = [c[0] * k, c[1] * k, c[2] * k]
    const over: RGB = [0, 1, 2].map((j) => out[j] * GLOW_ALPHA + BACKGROUND[j] * (1 - GLOW_ALPHA)) as RGB
    if (contrast(MUTED, over) >= MIN_CONTRAST) return out
  }
  return out
}

function luminance([r, g, b]: RGB) {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const toCss = ([r, g, b]: RGB) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
