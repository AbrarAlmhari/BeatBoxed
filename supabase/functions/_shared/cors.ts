import { logError } from './log.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** The details go to the function's logs; the browser gets a plain message. */
export function serverError(where: string, err: unknown, status = 500) {
  logError(where, 'request failed', { error: err })
  return json({ error: 'Something went wrong. Please try again.' }, status)
}
