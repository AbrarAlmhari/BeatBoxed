/**
 * What Spotify said when it refused a request. Its answers come in several
 * shapes: { error: { status, message, reason } } from the Web API, plain text
 * for an app-level refusal ("Active premium subscription required..."), and
 * sometimes an HTML page, which tells nobody anything.
 */
export type SpotifyFailure = {
  status: number
  reason: string | null
  /** Spotify's short code when it sends one, e.g. PREMIUM_REQUIRED. */
  code: string | null
  retryAfterSeconds: number | null
}

const MAX_REASON = 300

export async function readSpotifyFailure(res: Response): Promise<SpotifyFailure> {
  const text = (await res.text().catch(() => '')).trim()
  let reason: string | null = null
  let code: string | null = null

  try {
    const { error, error_description } = JSON.parse(text)
    if (typeof error === 'string') {
      reason = typeof error_description === 'string' ? error_description : error
    } else {
      if (typeof error?.message === 'string') reason = error.message
      if (typeof error?.reason === 'string') code = error.reason
    }
  } catch {
    if (text && !text.startsWith('<')) reason = text
  }

  const retryAfter = Number(res.headers.get('retry-after') ?? NaN)
  return {
    status: res.status,
    reason: reason ? reason.slice(0, MAX_REASON) : null,
    code,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
  }
}

/** Thrown when Spotify refuses, so each function can answer with the reason. */
export class SpotifyRefused extends Error {
  what: string
  failure: SpotifyFailure

  constructor(what: string, failure: SpotifyFailure) {
    // The whole reason, for the function's logs.
    super(`${what} failed: ${failure.status}${failure.reason ? `. ${failure.reason}` : ''}`)
    this.name = 'SpotifyRefused'
    this.what = what
    this.failure = failure
  }
}

/**
 * The browser's answer. Spotify's reason stays in the logs: it can name the
 * owner's subscription or the app's credentials. The status and the wait are
 * enough for the console, and the page shows its own plain note.
 */
export function spotifyFailureBody(failure: SpotifyFailure) {
  return {
    error: 'Spotify is unavailable right now.',
    spotify: { status: failure.status, retryAfterSeconds: failure.retryAfterSeconds },
  }
}
