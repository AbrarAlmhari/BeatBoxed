import { test, expect } from './fixtures'
import * as app from '../src/lib/config'
import * as functions from '../supabase/functions/_shared/config'

/**
 * The limits, timeouts and default models moved into src/lib/config.ts and
 * supabase/functions/_shared/config.ts with the values they had in their old
 * files. A change to one of them should be on purpose, so it means changing
 * this list too.
 */
const APP: Record<string, unknown> = {
  PASSWORD_MIN: 8,
  USERNAME_MIN: 4,
  USERNAME_MAX: 20,
  RESEND_CONFIRMATION_COOLDOWN_S: 30,
  PASSWORD_RESET_COOLDOWN_S: 60,
  BIO_MAX: 160,
  REVIEW_HEADLINE_MAX: 80,
  FEED_MIN_BODY_CHARS: 20,
  COMMENT_MAX: 500,
  TAGS_MIN: 3,
  TAGS_MAX: 8,
  TAG_MAX_LENGTH: 24,
  AVATAR_MAX_BYTES: 2 * 1024 * 1024,
  AVATAR_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  COVER_MAX_BYTES: 5 * 1024 * 1024,
  COVER_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  COVER_SIZE: 600,
  COVER_QUALITY: 0.85,
  FEED_PAGE_SIZE: 20,
  PROFILE_PAGE_SIZE: 20,
  PROFILE_LIST_PAGE_SIZE: 30,
  SONG_REVIEWS_PAGE_SIZE: 10,
  RAIL_SIZE: 12,
  RAIL_LIST_POOL: 60,
  RAIL_PAGE_SIZE: 20,
  MOST_LIKED_CAP: 500,
  SPOTIFY_TOPUP_THRESHOLD: 5,
  SPOTIFY_TOPUP_TIMEOUT_MS: 10_000,
  DISCOGRAPHY_SYNC_AFTER_HOURS: 24,
  BEATIE_CHAT_HISTORY: 10,
  BEATIE_QUESTION_MAX: 500,
  BEATIE_SLOW_AFTER_MS: 8000,
  TOAST_DISMISS_MS: 6000,
  MIN_PLAY_SECONDS: 5,
  SKIP_NOTICE_MS: 2000,
  STATS_MIN_RATINGS: 5,
  STATS_CACHE_MS: 30_000,
  SEEN_REVIEWS_MAX: 300,
  SEEN_REVIEWS_KEEP_MS: 14 * 24 * 3600 * 1000,
  SEEN_REVIEWS_FLUSH_MS: 3000,
  SONG_OF_THE_WEEK_TICK_MS: 60_000,
}

const FUNCTIONS: Record<string, unknown> = {
  GROQ_DEFAULT_MODEL: 'openai/gpt-oss-120b',
  GROQ_DEFAULT_FALLBACK_MODEL: 'qwen/qwen3.8-27b',
  VIBES_DEFAULT_MODEL: 'openai/gpt-oss-20b',
  GROQ_DEFAULT_TIMEOUT_MS: 40_000,
  REASONING_HEADROOM: 1024,
  BEATIE_USER_DAILY_LIMIT: 30,
  BEATIE_GLOBAL_DAILY_LIMIT: 150,
  BEATIE_REQUEST_BUDGET_MS: 120_000,
  BEATIE_CHAT_BUDGET_MS: 40_000,
  BEATIE_MIN_RETRY_MS: 20_000,
  BEATIE_RESPOND_WITHIN_MS: 25_000,
  BEATIE_PENDING_STALE_MS: 3 * 60_000,
  BEATIE_FAILED_HOLD_MS: 2 * 60_000,
  BEATIE_MAX_HISTORY: 10,
  BEATIE_MAX_QUESTION_CHARS: 500,
  BEATIE_MAX_MESSAGE_CHARS: 1000,
  BEATIE_EXPLAIN_MAX_TOKENS: 700,
  BEATIE_LINE_MAX_TOKENS: 350,
  BEATIE_CHAT_MAX_TOKENS: 400,
  TRANSLATION_REQUEST_TOKENS: 7000,
  TRANSLATION_PROMPT_CHARS: 700,
  TRANSLATION_MIN_TOKENS: 200,
  VIBES_BATCH: 5,
  VIBES_DAILY_CAP: 210,
  VIBES_MAX_TOKENS: 120,
  VIBES_TIMEOUT_MS: 30_000,
  VIBES_LYRICS_CHARS: 2500,
  VIBES_LYRICS_TIMEOUT_MS: 10_000,
  SPOTIFY_PAGE: 10,
  NEW_RELEASE_DAYS: 14,
  SPOTIFY_MAX_REASON_CHARS: 300,
  RELEASE_CHECK_BATCH_SIZE: 5,
  RELEASE_CHECK_BATCH_DELAY_MS: 1200,
  MUSICBRAINZ_DELAY_MS: 1100,
}

test.describe('settings in one place', () => {
  test('the app settings keep the values they had', () => {
    expect({ ...app }).toEqual(APP)
  })

  test('the Edge Function settings keep the values they had', () => {
    expect({ ...functions }).toEqual(FUNCTIONS)
  })

  test("Beatie's chat limits match on both sides", () => {
    expect(app.BEATIE_CHAT_HISTORY).toBe(functions.BEATIE_MAX_HISTORY)
    expect(app.BEATIE_QUESTION_MAX).toBe(functions.BEATIE_MAX_QUESTION_CHARS)
  })
})
