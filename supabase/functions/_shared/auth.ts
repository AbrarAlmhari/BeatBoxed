import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './cors.ts'

/**
 * Who is calling. The gateway's JWT check isn't enough on its own: the public
 * key passes it, and that key is in the site's code. So these functions ask
 * Supabase whether the token belongs to a real, current session.
 *
 *   'user'     a logged-in user's session
 *   'service'  our own scripts, holding the service role key
 *   null       anyone else, including the public key
 */
export type Caller = 'user' | 'service'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
  auth: { persistSession: false },
})

export async function callerOf(req: Request): Promise<Caller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  if (token === SERVICE_KEY) return 'service'
  const { data, error } = await admin.auth.getUser(token)
  if (error && error.status !== 401 && error.status !== 403) console.error('[auth]', error)
  return data?.user ? 'user' : null
}

export const notLoggedIn = () => json({ error: 'Please log in.' }, 401)
