# API Integrations — setup notes and gotchas

## Spotify Web API

Use the **Client Credentials flow** (app-level auth, no user login) for catalog search, track/artist/album metadata, and artwork. As of Feb 2026, Spotify's Development Mode requires the *developer* account to have Spotify Premium, allows one Development Mode Client ID per developer, and caps **authorized users at 5** — that cap applies to per-user OAuth (login-with-Spotify), not to Client Credentials calls, so build the MVP against Client Credentials wherever possible.

If any feature genuinely needs a logged-in Spotify user (e.g. importing a personal playlist), reserve that for a small, named set of test accounts (≤5) rather than building it as a feature every classmate can try during a demo.

Also check current access before designing around: 30-second preview URLs and some enrichment endpoints (audio features, recommendations, related artists) have been restricted for newer apps since late 2024 — verify in the Spotify Developer Dashboard for this app specifically rather than assuming.

Setup: register an app at https://developer.spotify.com/dashboard, get `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, exchange for an app access token server-side (never expose the secret to the frontend).

## Lyrics — lrclib.net (primary)

Free, open, no API key required. Supports plain and time-synced lyrics — the synced format is a good fit for the line-by-line "Now Playing" lyrics view. Query by artist + track name; no rate-limit key management needed for a project this size.

Genius (`api.genius.com`) can still be used for artist bios, song metadata, and linking out to Genius — but its API terms don't license returning full lyrics text, so don't use it (or the scraper-based community libraries built around it) as the lyrics source.

## Gemini API (Beatie)

Generate a key from **Google AI Studio** (https://aistudio.google.com), not from the consumer Gemini app — a Gemini Pro/Advanced subscription does not include API credits, they're billed/rate-limited separately. The free tier has generous-enough rate limits for a class project's usage pattern (a handful of users asking occasional questions). Store as `GEMINI_API_KEY`, called from a Supabase Edge Function so the key never reaches the browser.

Keep prompts scoped ("explain this specific lyric line," "translate this specific line") rather than open-ended chat — narrower prompts are both cheaper and more reliable.

## Environment variables

See `.env.example` at the repo root. Real keys go in `.env.local` (gitignored), never committed.
