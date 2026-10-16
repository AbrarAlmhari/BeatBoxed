import { supabase } from './supabase'
import type { SongCardModel } from './types'

/**
 * New-user setup (/welcome), the Beatie tour and the one-time welcome card
 * for existing users. State lives on the profile (migration 0039):
 *
 *   setup_completed_at        null until /welcome is finished; existing
 *                             accounts were marked done by the migration
 *   setup_step                where they were, so leaving halfway resumes
 *   tutorial_completed_at     finished the tour
 *   tutorial_skipped_at       skipped it
 *   welcome_card_dismissed_at closed the "Your music tags are back" card
 */

function client() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export const SETUP_STEPS = 7
/** setup_step for the "All set" screen after step 7. */
export const SETUP_ALL_SET = 8

export type OnboardingState = {
  setupCompletedAt: string | null
  setupStep: number | null
  tutorialCompletedAt: string | null
  tutorialSkippedAt: string | null
  welcomeCardDismissedAt: string | null
}

export async function getOnboardingState(userId: string): Promise<OnboardingState | null> {
  const { data, error } = await client()
    .from('profiles')
    .select('setup_completed_at, setup_step, tutorial_completed_at, tutorial_skipped_at, welcome_card_dismissed_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    setupCompletedAt: data.setup_completed_at,
    setupStep: data.setup_step,
    tutorialCompletedAt: data.tutorial_completed_at,
    tutorialSkippedAt: data.tutorial_skipped_at,
    welcomeCardDismissedAt: data.welcome_card_dismissed_at,
  }
}

async function patchProfile(userId: string, patch: Record<string, unknown>) {
  const { error } = await client().from('profiles').update(patch).eq('id', userId)
  if (error) throw error
}

/** Remembers the step they're on, so closing the app resumes there. */
export function saveSetupStep(userId: string, step: number) {
  return patchProfile(userId, { setup_step: step })
}

/**
 * Setup is done. The welcome card is for existing users; someone who just
 * picked their tags in setup doesn't need it, so it's marked closed too.
 */
export function completeSetup(userId: string) {
  const now = new Date().toISOString()
  return patchProfile(userId, { setup_completed_at: now, setup_step: SETUP_ALL_SET, welcome_card_dismissed_at: now })
}

export function markTour(userId: string, outcome: 'completed' | 'skipped') {
  const now = new Date().toISOString()
  return patchProfile(userId, outcome === 'completed' ? { tutorial_completed_at: now } : { tutorial_skipped_at: now })
}

export function dismissWelcomeCard(userId: string) {
  return patchProfile(userId, { welcome_card_dismissed_at: new Date().toISOString() })
}

export async function setMusicTags(userId: string, tags: string[]) {
  return patchProfile(userId, { favorite_genres: tags })
}

/* ------------------------------------------------------------ suggestions */

export type SuggestedReviewer = {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  reviewCount: number
  alsoInto: string[]
}

export async function suggestedReviewers(tags: string[], limit = 5): Promise<SuggestedReviewer[]> {
  const { data, error } = await client().rpc('suggested_reviewers_for_tags', { p_tags: tags, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
    review_count: number
    also_into: string[] | null
  }[]).map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    reviewCount: Number(r.review_count),
    alsoInto: r.also_into ?? [],
  }))
}

export type SuggestedArtist = { id: string; name: string; imageUrl: string | null }

export async function suggestedArtists(tags: string[], limit = 9): Promise<SuggestedArtist[]> {
  const { data, error } = await client().rpc('suggested_artists', { p_tags: tags, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as { id: string; name: string; image_url: string | null }[]).map((a) => ({
    id: a.id,
    name: a.name,
    imageUrl: a.image_url,
  }))
}

/** Songs to like: by the artists just followed, or matching the tags. */
export async function suggestedSongs(artistIds: string[], tags: string[], limit = 5): Promise<SongCardModel[]> {
  const { data, error } = await client().rpc('suggested_songs', {
    p_artist_ids: artistIds,
    p_tags: tags,
    p_limit: limit,
  })
  if (error) throw error
  return ((data ?? []) as {
    id: string
    title: string
    artist_id: string
    artist_name: string
    album_id: string | null
    cover_url: string | null
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    artistName: s.artist_name,
    artistId: s.artist_id,
    albumId: s.album_id,
    coverUrl: s.cover_url,
    ratingAvg: null,
    reviewCount: 0,
  }))
}

/** Counts for the "All set" card. */
export async function setupCounts(userId: string) {
  const c = client()
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  }
  const [people, artists, liked, reviews] = await Promise.all([
    count(c.from('user_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId)),
    count(c.from('follows').select('artist_id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(c.from('song_likes').select('song_id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(c.from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
  ])
  return { people, artists, liked, reviews }
}
