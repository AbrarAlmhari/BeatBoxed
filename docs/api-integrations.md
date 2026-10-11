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
- `provider.ts`: the only Gemini-specific code (model, endpoint, request and response format, secret names), behind `generate(systemPrompt, messages, options)`. Switching AI provider means rewriting this file and setting a different secret.
- `personality.md`: Beatie's voice and rules, editable without touching code. Used as the system prompt for explanations and chat, followed by the song context. It must stay listed under `static_files` in `supabase/config.toml` to be deployed.
- `prompts.ts`: the song context, the task wording, the separate short translation instruction (translations don't use the personality), and the lyric-quote check.
- `index.ts`: the request flow, cache, limits and error codes.

**Cache:** `beatie_cache` (see `docs/data-model.md`). A cache hit is answered without calling Gemini and doesn't count toward any limit. An answer made while the lyrics lookup was failing is shown but not cached, so a temporary lrclib outage can't record "no lyrics" for a song permanently.

**Limits** (constants at the top of `index.ts`): 30 requests per user per day, and 150 Gemini calls per day for the whole app, retries included. Both are taken by `beatie_take_quota()` in single statements, so rapid requests can't get past them. Days reset at midnight UTC. There is never more than one automatic retry per request: once if an explanation or chat answer quotes too much of the lyrics, once if a translation's line count is off.

**Lyric safety:** explanations and chat may quote at most one lyric line (a line explanation, only the line being explained). An answer that quotes more is retried once with a stricter instruction, then not shown. Translations are exempt: they translate every line, and appear only on the Song page.

**Errors** come back as codes, and the app turns each into a friendly message, never a raw error: `limit` (this user's 30 are used), `global` ("Beatie is taking a break, try again later"), `busy` (Gemini down, rate-limited or too slow, or this answer failed in the last 2 minutes: "Beatie is taking a break, try again in a minute"), `pending` ("Beatie's still writing this one, check back in a moment"), `error` (anything else).

### The model

The live model is set by the Supabase secret **`GEMINI_MODEL`**, read on every request: currently **`gemini-3.6-flash`**. If the secret isn't set, `FALLBACK_MODEL` in `provider.ts` applies, kept the same: `gemini-3.6-flash`.

Why 3.6 rather than the newer 3.8 (October 2026): `gemini-3.8-flash` answered HTTP 503 (overloaded) and was too slow for an Arabic explanation, while `gemini-3.6-flash` answered the same request in about 15 seconds. 3.6 Flash also accepts thinking level `low` (and `minimal`) per Google's thinking docs. `gemini-3.5-flash` still appears in the key's model list but isn't in Google's current docs, so it wasn't used.

To change it:
1. List the models the key can use (this uses no generation quota): `GET https://generativelanguage.googleapis.com/v1beta/models` with the header `x-goog-api-key: <GEMINI_API_KEY>`. Pick one whose `supportedGenerationMethods` includes `generateContent`. Run it from somewhere the key already lives (the key is only a Supabase secret), and never commit the key.
2. `supabase secrets set GEMINI_MODEL=<model name>`. No redeploy needed.
3. If the new model should also be the default, update `FALLBACK_MODEL` in `provider.ts` and redeploy.

Google retires model names: `gemini-2.5-flash` started answering 404 ("no longer available to new users") in October 2026, which is why the model is a secret rather than a constant. When that happens, Beatie shows its general error message and the function log shows `[beatie] provider error HTTP 404`.

**Thinking:** Gemini 3 Flash models always think before answering. Beatie sets `generationConfig.thinkingConfig.thinkingLevel: "low"` (`THINKING_LEVEL` in `provider.ts`), accepted by both `gemini-3.6-flash` (which takes minimal, low, medium, high) and `gemini-3.8-flash` (low, medium, high; `minimal` is rejected) ([Google's thinking docs](https://ai.google.dev/gemini-api/docs/generate-content/thinking)). At the default, a long song ran past Beatie's old 25-second wait. Thinking tokens count toward the output limit, so every request also allows 2,048 extra output tokens (`THINKING_HEADROOM`). A different `GEMINI_MODEL` may need a different setting: Gemini 2.5 models use `thinkingBudget` instead.

**Waiting:** each job has a budget for all its Gemini calls together. Explanations, line explanations and translations get 140 seconds (`CACHED_BUDGET_MS` in `index.ts`), just under Supabase's 150-second limit for a function: they're cached, and past 25 seconds they finish in the background while the user sees "check back", so nobody waits that long. Chat gets 40 seconds (`CHAT_BUDGET_MS`): it isn't cached and the user is waiting on it. A retry only starts if at least 20 seconds of budget remain. In the app, "Beatie is thinking…" becomes "Still thinking… long songs take a moment" after 8 seconds.

**Finishing in the background:** a cacheable answer that isn't ready after 25 seconds (`RESPOND_WITHIN_MS`) is left to finish on the server (`EdgeRuntime.waitUntil`). The app shows "Beatie's still writing this one, check back in a moment" (code `pending`); the answer lands in the cache, and the next tap loads it free. While an answer is being written, its `beatie_cache` row exists with empty `content`: a claim, which the table's unique key lets only one request make, so the answer is asked of Gemini, and counted, once however many taps or people arrive meanwhile. A claim older than 3 minutes (`PENDING_STALE_MS`) means the background work died; it's cleared and the next tap starts again.

**Remembering failures:** when a job fails (Gemini down or too slow, or its answer rejected), its row holds the marker `__beatie_failed__` for 2 minutes (`FAILED_HOLD_MS`). Taps meanwhile get "Beatie is taking a break" without calling Gemini. A quota refusal (`limit`, `global`) just releases the claim, since it's about the user or the day, not the song.

**Answer checks:** before an answer is shown or cached it's rejected, with the reason logged, if it was cut off at the token limit (finish reason `MAX_TOKENS`), or, for explanations and chat, if it repeats a sentence 3+ times or a 6-word phrase 4+ times (`repetitionProblem` in `prompts.ts`). Translations skip the repetition check: songs repeat their chorus, so a faithful translation does too. These rejections aren't retried.

**Logs** (Supabase dashboard → Functions → beatie → Logs; never shown to users): every Gemini call is streamed (`streamGenerateContent`) and logged as `[beatie] gemini <kind> <song> <language> try <n>: model=… finish=… thinking=<tokens> answer=<tokens> prompt=<tokens> ms=… firstChunkMs=… chars=…`. A call that runs out of time logs `gave up after <ms>` with the tokens so far and `last100=` the last ~100 characters received. Rejected answers log `[beatie] answer rejected (…): <reason>`; lyric-quote rejections give line numbers only.

**Deploying:** `supabase functions deploy beatie --use-api` (`--use-api` bundles on Supabase's side, so Docker isn't needed). The migration `0029_beatie.sql` must be applied first.

**Lyrics language** (for showing the Translate button) is detected in the browser without AI: by alphabet for Arabic and Hindi, and by how many very common English words a Latin-script text has.

## Environment variables

See `.env.example` at the repo root. Real keys go in `.env.local` (gitignored), never committed.
