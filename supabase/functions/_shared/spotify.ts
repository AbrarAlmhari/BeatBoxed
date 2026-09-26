/**
 * Client Credentials token, cached at module scope. Edge Function isolates are
 * reused between invocations, so this avoids a token request per call; when an
 * isolate is recycled the next call simply fetches a fresh one.
 */
type CachedToken = { value: string; expiresAt: number }
let cached: CachedToken | null = null

export async function getSpotifyToken(): Promise<string> {
  // 60s of headroom so a token can't expire mid-request.
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.value

  const id = Deno.env.get('SPOTIFY_CLIENT_ID')
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
  if (!id || !secret) {
    throw new Error(
      'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set. Run: supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...'
    )
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  })

  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  cached = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return cached.value
}

export type SpotifyImage = { url: string; width: number; height: number }

/** Largest image first is Spotify's order; take it for artwork. */
export const pickImage = (images?: SpotifyImage[]) => images?.[0]?.url ?? null
