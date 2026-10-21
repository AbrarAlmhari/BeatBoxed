Supabase Edge Functions — this is where server-side secrets (GROQ_API_KEY, SPOTIFY_CLIENT_SECRET) actually get used, so they never reach the browser bundle. beatie holds Beatie's AI calls, through Groq (beatie/groq.ts); song-vibes labels songs for the daily check-in, also through Groq (beatie/groq.ts) but with its own model; spotify-token does the Client Credentials exchange and caching.

beatie reads personality.md at startup; supabase/config.toml lists it under static_files so it's deployed with the function. Deploy with `supabase functions deploy beatie`.

## Secrets

| Secret | Used by | What it is |
| --- | --- | --- |
| `GROQ_API_KEY` | beatie | Groq API key. |
| `GROQ_MODEL` | beatie | Beatie's model. Default `openai/gpt-oss-120b`. |
| `GROQ_FALLBACK_MODEL` | beatie | Tried once when the main model is busy (overloaded, rate limited, down or too slow) and there's time left; it counts against the daily cap. Default `qwen/qwen3.8-27b`. |
| `VIBES_GROQ_MODEL` | song-vibes | The labelling model. Default `openai/gpt-oss-20b`. No backup. |

The model secrets are read on every request, so changing one with `supabase secrets set` takes effect without a redeploy. `GEMINI_API_KEY` and `GEMINI_MODEL` are no longer read by anything (beatie/provider.ts is kept but unused).

`beatie/groq_test.ts` checks groq.ts against a fake Groq server, with no real calls: from this folder, `deno run --allow-env beatie/groq_test.ts`.
