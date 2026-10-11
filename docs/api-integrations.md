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

Generate a key from **Google AI Studio** (https://aistudio.google.com), not from the consumer Gemini app — a Gemini Pro/Advanced subscription does not include API credits, they're billed/rate-limited separately. The key is stored only as the Supabase secret `GEMINI_API_KEY` (`supabase secrets set GEMINI_API_KEY=...`). It is never in the repo and never reaches the browser; the frontend needs no Gemini setting at all.

### The `beatie` Edge Function

Every Beatie request goes through `supabase/functions/beatie/`. The browser sends only a song id (plus the conversation, for chat):

| action | What it does | Cached? |
|---|---|---|
| `explain` | "What's this song about?" | Yes, per song + language |
| `line` | Explain one lyric line (must be a real line of the song) | Yes, per song + line + language |
| `translate` | The whole song, one request, returned as a JSON array with one line per original; one retry if the count is off | Yes, per song + language |
| `chat` | A follow-up question; at most the 10 most recent messages, a question of at most 500 characters | Never |

For each request the function checks the user is signed in, loads the song, artist and album from the database, reads the user's language (`profiles.translation_language`, English if unset), and fetches the lyrics itself through `lyrics-lookup`, asked the same way the Song page asks so both get the same lines.

**Files:**
- `provider.ts`: the only Gemini-specific code (model, endpoint, request and response format, secret name), behind `generate(systemPrompt, messages, options)`. Switching AI provider means rewriting this file and setting a different secret. The model is the `MODEL` constant there (`gemini-2.5-flash`, on the free tier). Thinking is turned off: Beatie's answers are short, and thinking tokens use the same free-tier quota.
- `personality.md`: Beatie's voice and rules, editable without touching code. Used as the system prompt for explanations and chat, followed by the song context. It must stay listed under `static_files` in `supabase/config.toml` to be deployed.
- `prompts.ts`: the song context, the task wording, the separate short translation instruction (translations don't use the personality), and the lyric-quote check.
- `index.ts`: the request flow, cache, limits and error codes.

**Cache:** `beatie_cache` (see `docs/data-model.md`). A cache hit is answered without calling Gemini and doesn't count toward any limit. An answer made while the lyrics lookup was failing is shown but not cached, so a temporary lrclib outage can't record "no lyrics" for a song permanently.

**Limits** (constants at the top of `index.ts`): 30 requests per user per day, and 150 Gemini calls per day for the whole app, retries included. Both are taken by `beatie_take_quota()` in single statements, so rapid requests can't get past them. Days reset at midnight UTC. There is never more than one automatic retry per request: once if an explanation or chat answer quotes too much of the lyrics, once if a translation's line count is off.

**Lyric safety:** explanations and chat may quote at most one lyric line (a line explanation, only the line being explained). An answer that quotes more is retried once with a stricter instruction, then not shown. Translations are exempt: they translate every line, and appear only on the Song page.

**Errors** come back as codes, and the app turns each into a friendly message, never a raw error: `limit` (this user's 30 are used), `global` ("Beatie is taking a break, try again later"), `busy` (Gemini down or rate-limited: "Beatie is taking a break, try again in a minute"), `error` (anything else).

**Deploying:** `supabase functions deploy beatie`. The migration `0029_beatie.sql` must be applied first.

**Lyrics language** (for showing the Translate button) is detected in the browser without AI: by alphabet for Arabic and Hindi, and by how many very common English words a Latin-script text has.

## Environment variables

See `.env.example` at the repo root. Real keys go in `.env.local` (gitignored), never committed.
