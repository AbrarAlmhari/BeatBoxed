/**
 * The Edge Functions' limits, timeouts and default model names, in one place.
 * Each function imports what it needs from here; the values are the same as
 * when they lived in each function. Secrets (keys, and the model secrets that
 * override these defaults) stay in Supabase, never here.
 */

/* ------------------------------------------------------------------ Groq */

/**
 * Default models, used when the GROQ_MODEL, GROQ_FALLBACK_MODEL and
 * VIBES_GROQ_MODEL secrets aren't set. The secrets are read per request, so
 * `supabase secrets set` changes the model with no redeploy.
 */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
export const GROQ_DEFAULT_FALLBACK_MODEL = 'qwen/qwen3.8-27b'
export const VIBES_DEFAULT_MODEL = 'openai/gpt-oss-20b'

/** How long to wait for Groq unless the caller says otherwise. */
export const GROQ_DEFAULT_TIMEOUT_MS = 40_000

/**
 * Reasoning models count their reasoning in the same max_tokens as the
 * answer, so they get this much extra room on top of options.maxTokens, so
 * reasoning can't use up the answer's share and leave it cut off.
 */
export const REASONING_HEADROOM = 1024

/* ---------------------------------------------------------------- Beatie */

/** Per user per day. Cache hits don't count. */
export const BEATIE_USER_DAILY_LIMIT = 30
/** Model calls per day for the whole app, retries and backups included. */
export const BEATIE_GLOBAL_DAILY_LIMIT = 150

/**
 * How long a request may run, measured from the moment it arrives (before
 * the song and lyrics are loaded), all its model calls together.
 * Explanations, line explanations and translations are cached and, past
 * BEATIE_RESPOND_WITHIN_MS, finish in the background while the user sees
 * "check back", so they get up to 120 seconds in total: well inside
 * Supabase's 150-second limit for a function, however long the lookups
 * before the first call took. Chat isn't cached and the user is waiting on
 * it, so it gets 40.
 */
export const BEATIE_REQUEST_BUDGET_MS = 120_000
export const BEATIE_CHAT_BUDGET_MS = 40_000

/**
 * The lyric-quote retry, and the backup model when the primary is busy,
 * only start if at least this much budget is left.
 */
export const BEATIE_MIN_RETRY_MS = 20_000

/**
 * A cacheable answer not ready by now is left to finish in the background:
 * the app hears 'pending', and the answer lands in the cache for the next tap.
 */
export const BEATIE_RESPOND_WITHIN_MS = 25_000

/**
 * An empty (in-progress) cache row older than this means its background work
 * died (the function was stopped); it's cleared and the work starts again.
 */
export const BEATIE_PENDING_STALE_MS = 3 * 60_000

/**
 * After a job fails (Groq down, too slow, or an answer rejected), its row
 * holds a failure marker for this long, and taps meanwhile get 'busy'
 * ("taking a break") without calling Groq again. Then the next tap tries
 * afresh.
 */
export const BEATIE_FAILED_HOLD_MS = 2 * 60_000

/** Chat: the most recent messages sent on, and the longest question and message. */
export const BEATIE_MAX_HISTORY = 10
export const BEATIE_MAX_QUESTION_CHARS = 500
export const BEATIE_MAX_MESSAGE_CHARS = 1000

/** The longest answer asked for, in tokens, before the reasoning room. */
export const BEATIE_EXPLAIN_MAX_TOKENS = 700
export const BEATIE_LINE_MAX_TOKENS = 350
export const BEATIE_CHAT_MAX_TOKENS = 400

/**
 * Translations: a request's lyrics (taken at 2 characters a token), its
 * output limit and the reasoning room together stay within
 * TRANSLATION_REQUEST_TOKENS, under the models' 8,000 tokens a minute.
 * TRANSLATION_PROMPT_CHARS allows for the instructions around the lyrics.
 * See translationMaxTokens() in beatie/prompts.ts.
 */
export const TRANSLATION_REQUEST_TOKENS = 7000
export const TRANSLATION_PROMPT_CHARS = 700
/** Lyrics too long to fit at all: still a valid request, and a cut-off answer is rejected. */
export const TRANSLATION_MIN_TOKENS = 200

/* ------------------------------------------------------------ song-vibes */

/** Songs labelled per run, and model calls per day at most. */
export const VIBES_BATCH = 5
export const VIBES_DAILY_CAP = 210
/** The longest label asked for, in tokens, and how long to wait for one. */
export const VIBES_MAX_TOKENS = 120
export const VIBES_TIMEOUT_MS = 30_000
/** Lyrics sent with a song, at most, and how long to wait for lrclib. */
export const VIBES_LYRICS_CHARS = 2500
export const VIBES_LYRICS_TIMEOUT_MS = 10_000

/* --------------------------------------------------------------- Spotify */

/** Spotify rejects limit > 10 for this app, on search and on albums alike. */
export const SPOTIFY_PAGE = 10
/**
 * A release counts as new only this close to today. Matches the window
 * notify_artist_release() enforces in the database.
 */
export const NEW_RELEASE_DAYS = 14
/** Longest Spotify reason kept for the logs. */
export const SPOTIFY_MAX_REASON_CHARS = 300

/** artist-release-check: artists checked at a time, and the pause between batches. */
export const RELEASE_CHECK_BATCH_SIZE = 5
export const RELEASE_CHECK_BATCH_DELAY_MS = 1200

/* ---------------------------------------------------------- MusicBrainz */

/** MusicBrainz allows one request a second, so artist-genres waits this long between two. */
export const MUSICBRAINZ_DELAY_MS = 1100
