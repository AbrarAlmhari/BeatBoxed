/**
 * What an Edge Function said when it failed, for the console: its JSON answer
 * when it gave one (the Spotify functions include Spotify's status code). The
 * full reason is in the function's logs.
 */
export async function failureDetails(error: unknown) {
  const response = (error as { context?: unknown }).context
  if (!(response instanceof Response)) return error
  return response.json().catch(() => error)
}
