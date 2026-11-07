Supabase Edge Functions — this is where server-side secrets (GROQ_API_KEY, SPOTIFY_CLIENT_SECRET) actually get used, so they never reach the browser bundle. beatie holds Beatie's AI calls, through Groq (beatie/groq.ts); song-vibes labels songs for the daily check-in, also through Groq (beatie/groq.ts) but with its own model. The Spotify functions get their Client Credentials token from _shared/spotify.ts, which also caches it; the token never leaves the server.

beatie reads personality.md at startup; supabase/config.toml lists it under static_files so it's deployed with the function. Deploy with `supabase functions deploy beatie`.

## Secrets

| Secret | Used by | What it is |
| --- | --- | --- |
| `GROQ_API_KEY` | beatie | Groq API key. |
| `GROQ_MODEL` | beatie | Beatie's model. Default `openai/gpt-oss-120b`. |
| `GROQ_FALLBACK_MODEL` | beatie | Tried once when the main model is busy (overloaded, rate limited, down or too slow) or gone (unknown or retired) and there's time left; it counts against the daily cap. Default `qwen/qwen3.8-27b`. |
| `VIBES_GROQ_MODEL` | song-vibes | The labelling model. Default `openai/gpt-oss-20b`. No backup. |

The model secrets are read on every request, so changing one with `supabase secrets set` takes effect without a redeploy. `GEMINI_API_KEY` and `GEMINI_MODEL` are no longer read by anything (beatie/provider.ts is kept but unused).

`npm run check:functions` type-checks every function. `npm run test:functions` runs spotify-search, spotify-artist, lyrics-lookup and artist-genres as local servers against a fake Spotify, login service and database, with no real calls. Both need these flags because Deno would otherwise look for its packages in the app's `node_modules`.

`beatie/groq_test.ts` checks groq.ts against a fake Groq server, with no real calls: from this folder, `deno run --allow-env beatie/groq_test.ts`.
