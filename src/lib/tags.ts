/**
 * Music tags: what someone says they're into, shown on their profile. They
 * live in profiles.favorite_genres (the column the old genre picker used);
 * the database keeps them to at most 8, each up to 24 characters, with no
 * repeats ignoring capitals (migration 0039).
 *
 * They're the user's own words. The genres worked out from their reviews
 * are something else, and stay on the Stats tab.
 */

/** The tags offered in setup and Edit profile, in the mockups' order. */
export const MUSIC_TAGS = [
  'Pop',
  'Hip-Hop',
  'R&B',
  'Rock',
  'Indie',
  'Electronic',
  'Arabic',
  'Khaleeji',
  'K-Pop',
  'Jazz',
  'Soul',
  'Lo-fi',
  'Metal',
  'Latin',
  'Afrobeats',
  'Classical',
  'Country',
  'South Asian',
] as const

export const TAGS_MIN = 3
export const TAGS_MAX = 8
export const TAG_MAX_LENGTH = 24

/**
 * How a stored tag is shown. The old picker saved lowercase genre names
 * ("r&b", "lo-fi", "indie rock"); those are shown with the offered label
 * when there is one, otherwise with each word capitalised. Nothing stored
 * is rewritten.
 */
const LABELS: Record<string, string> = Object.fromEntries(MUSIC_TAGS.map((t) => [t.toLowerCase(), t]))
Object.assign(LABELS, {
  'hip hop': 'Hip-Hop',
  'rnb': 'R&B',
  'lofi': 'Lo-fi',
  'kpop': 'K-Pop',
  'electronic music': 'Electronic',
})

export function tagLabel(tag: string) {
  const key = tag.trim().toLowerCase()
  if (LABELS[key]) return LABELS[key]
  // "indie rock" -> "Indie Rock"; anything already capitalised is kept.
  if (tag !== key) return tag.trim()
  return key.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Same tag, ignoring capitals and spaces at the ends (the database's rule). */
export function sameTag(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** A custom tag as typed, cleaned up; null when it can't be used. */
export function cleanCustomTag(raw: string) {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (!t || t.length > TAG_MAX_LENGTH) return null
  return t
}
