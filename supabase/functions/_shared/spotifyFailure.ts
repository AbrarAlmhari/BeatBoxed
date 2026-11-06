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

/** The function's answer: `error` to read at a glance, `spotify` for the details. */
export function spotifyFailureBody(what: string, failure: SpotifyFailure) {
  const summary = `${what} failed: ${failure.status}`
  return {
    error: failure.reason ? `${summary}. ${failure.reason}` : summary,
    spotify: failure,
  }
}
