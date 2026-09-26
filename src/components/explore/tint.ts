/** Stable 0–1 value from a string, so a genre or artist always gets the same hue. */
export function tintFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997
  return h / 997
}
