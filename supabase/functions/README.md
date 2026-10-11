Supabase Edge Functions — this is where server-side secrets (GEMINI_API_KEY, SPOTIFY_CLIENT_SECRET) actually get used, so they never reach the browser bundle. beatie holds the Gemini calls (see docs/api-integrations.md); spotify-token does the Client Credentials exchange and caching.

beatie reads personality.md at startup; supabase/config.toml lists it under static_files so it's deployed with the function. Deploy with `supabase functions deploy beatie`.
