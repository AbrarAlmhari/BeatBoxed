import { corsHeaders, json } from '../_shared/cors.ts'
import { getSpotifyToken } from '../_shared/spotify.ts'

/**
 * Returns a Spotify app token. JWT verification is left ON (the default) so
 * only signed-in users can reach it — an open endpoint handing out tokens
 * would let anyone burn this app's Spotify rate limit.
 *
 * spotify-search does NOT call this over HTTP; it imports getSpotifyToken()
 * directly to avoid a pointless round trip.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = await getSpotifyToken()
    return json({ access_token: token })
  } catch (err) {
    console.error('[spotify-token]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
