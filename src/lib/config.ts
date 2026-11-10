/**
 * The app's limits, timeouts and page sizes, in one place. Each module
 * imports what it needs from here (some pass a value on under the name its
 * importers already use); the values are the same as when they lived in
 * each file. The Edge Functions have their own: supabase/functions/_shared/config.ts.
 */

/* ------------------------------------------------------------ accounts */

/** Sign-up's rule, shared by reset and change password. As the sign-up mockup says. */
export const PASSWORD_MIN = 8

/**
 * The username rule, the same as the database's (migration 0037): 4–20
 * characters. See username.ts for the rest of the rule.
 */
export const USERNAME_MIN = 4
export const USERNAME_MAX = 20

/** Supabase limits how often a confirmation email can be resent. */
export const RESEND_CONFIRMATION_COOLDOWN_S = 30

/**
 * Supabase sends at most one reset email per address a minute, so the
 * resend waits that long.
 */
export const PASSWORD_RESET_COOLDOWN_S = 60

/* --------------------------------------------------------- text lengths */

/** A bio's length, in setup and Edit profile alike. */
export const BIO_MAX = 160
/** A review's headline. */
export const REVIEW_HEADLINE_MAX = 80
/**
 * How much body text (trimmed, in characters; the headline doesn't count) a
 * review needs to appear in the feed. 20 is about four words ("The chorus
 * hits so hard"): enough to be a thought, short enough that nobody has to
 * pad a review to reach it, and still enough to keep one-word "fire" posts
 * and star-only ratings out. It's passed to the database functions rather
 * than repeated there, so this is the one place to change it.
 *
 * Shorter and star-only reviews still count in song averages and still
 * show on song pages. Longer reviews get a gentle boost in For You
 * (migration 0038), so length still pays off without being required.
 */
export const FEED_MIN_BODY_CHARS = 20
/** A comment or reply. */
export const COMMENT_MAX = 500
/** Music tags on a profile, and the longest custom tag. */
export const TAGS_MIN = 3
export const TAGS_MAX = 8
export const TAG_MAX_LENGTH = 24

/* -------------------------------------------------------------- images */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp']
/** Big enough for the largest place a cover is shown, on a 2x screen. */
export const COVER_SIZE = 600
export const COVER_QUALITY = 0.85

/* ---------------------------------------------------------- page sizes */

/** About a screenful at a time. */
export const FEED_PAGE_SIZE = 20
export const PROFILE_PAGE_SIZE = 20
/** Followers, following, artists, reviews and playlists lists on a profile. */
export const PROFILE_LIST_PAGE_SIZE = 30
/** Reviews on a song page. */
export const SONG_REVIEWS_PAGE_SIZE = 10
/** Songs a rail shows on Explore. */
export const RAIL_SIZE = 12
/**
 * How many songs For You and Recently viewed work out in full. The rail is
 * the first RAIL_SIZE of the same list its "See all" page shows, so the two
 * always agree on which songs and in what order.
 */
export const RAIL_LIST_POOL = 60
/** A "See all" page loads this many at a time. */
export const RAIL_PAGE_SIZE = 20
/** Most liked can't be ordered by the database; this many are sorted in the app. */
export const MOST_LIKED_CAP = 500

/* ------------------------------------------------------------- Spotify */

/** Below this many local hits, a search reaches out to Spotify and caches more. */
export const SPOTIFY_TOPUP_THRESHOLD = 5
/** A top-up normally answers in about 2s. */
export const SPOTIFY_TOPUP_TIMEOUT_MS = 10_000
/** Re-sync an artist's discography at most this often. */
export const DISCOGRAPHY_SYNC_AFTER_HOURS = 24

/* -------------------------------------------------------------- Beatie */

/** The most recent messages sent with each chat question. */
export const BEATIE_CHAT_HISTORY = 10
/** Longest question Beatie accepts; the server enforces it too. */
export const BEATIE_QUESTION_MAX = 500
/** After this long, Beatie's loading text says it's still going. */
export const BEATIE_SLOW_AFTER_MS = 8000

/* ------------------------------------------------- timings and caching */

/** Long enough to read and act on a toast, short enough not to linger. */
export const TOAST_DISMISS_MS = 6000
/**
 * A play only counts once it has run this long. Tapping a card and skipping
 * straight on isn't listening, and letting it count would fill Recently
 * Viewed with songs the user rejected.
 */
export const MIN_PLAY_SECONDS = 5
/**
 * How long "no preview, skipping" stays up before moving on. Long enough to
 * read why the song changed by itself, short enough not to feel stuck.
 */
export const SKIP_NOTICE_MS = 2000
/** Fewer ratings than this in a range and the Stats tab shows the warm-up state. */
export const STATS_MIN_RATINGS = 5
/** Stats are kept briefly, so the header's genre chips and the Stats tab share one call. */
export const STATS_CACHE_MS = 30_000
/** Reviews this device scrolled past: the newest this many, for this long, written this far apart. */
export const SEEN_REVIEWS_MAX = 300
export const SEEN_REVIEWS_KEEP_MS = 14 * 24 * 3600 * 1000
export const SEEN_REVIEWS_FLUSH_MS = 3000
/** How often the song of the week checks whether the week has changed. */
export const SONG_OF_THE_WEEK_TICK_MS = 60_000
