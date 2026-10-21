# API Integrations — setup notes and gotchas

## Spotify Web API

Use the **Client Credentials flow** (app-level auth, no user login) for catalog search, track/artist/album metadata, and artwork. As of Feb 2026, Spotify's Development Mode requires the *developer* account to have Spotify Premium, allows one Development Mode Client ID per developer, and caps **authorized users at 5** — that cap applies to per-user OAuth (login-with-Spotify), not to Client Credentials calls, so build the MVP against Client Credentials wherever possible.

If any feature genuinely needs a logged-in Spotify user (e.g. importing a personal playlist), reserve that for a small, named set of test accounts (≤5) rather than building it as a feature every classmate can try during a demo.

Also check current access before designing around: 30-second preview URLs and some enrichment endpoints (audio features, recommendations, related artists) have been restricted for newer apps since late 2024 — verify in the Spotify Developer Dashboard for this app specifically rather than assuming.

Setup: register an app at https://developer.spotify.com/dashboard, get `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, exchange for an app access token server-side (never expose the secret to the frontend).

## Lyrics — lrclib.net (primary)

Free, open, no API key required. Supports plain and time-synced lyrics — the synced format is a good fit for the line-by-line "Now Playing" lyrics view. Query by artist + track name; no rate-limit key management needed for a project this size.

Genius (`api.genius.com`) can still be used for artist bios, song metadata, and linking out to Genius — but its API terms don't license returning full lyrics text, so don't use it (or the scraper-based community libraries built around it) as the lyrics source.

## Groq API (Beatie)

Beatie's answers come from Groq's OpenAI-compatible chat API (`https://api.groq.com/openai/v1/chat/completions`). The key is stored only as the Supabase secret `GROQ_API_KEY` (`supabase secrets set GROQ_API_KEY=...`). It is never in the repo and never reaches the browser; the frontend needs no AI setting at all.

The `song-vibes` function that labels songs for the daily check-in (see `supabase/functions/song-vibes/`) also goes through `groq.ts`, with the same key but its own model, the secret `VIBES_GROQ_MODEL` (default `openai/gpt-oss-20b`), and no backup model. Its labels record the model as `groq/<model>` in `song_vibes.model`. It makes at most 150 calls a day, failures included (`DAILY_CAP`), 5 songs per run.

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
- `groq.ts`: the only Groq-specific code (models, endpoint, request and response format, secret names), behind `generate(systemPrompt, messages, options)`, with the same signature and types as `provider.ts`. `index.ts` imports from here.
- `provider.ts`: the earlier Gemini version of the same surface, no longer called by any function. `groq.ts` borrows its types.
- `personality.md`: Beatie's voice and rules, editable without touching code. Used as the system prompt for explanations and chat, followed by the song context. It must stay listed under `static_files` in `supabase/config.toml` to be deployed.
- `prompts.ts`: the song context, the task wording, the separate short translation instruction (translations don't use the personality), and the lyric-quote check.
- `index.ts`: the request flow, cache, limits and error codes.

**Cache:** `beatie_cache` (see `docs/data-model.md`). A cache hit is answered without calling the AI service and doesn't count toward any limit. An answer made while the lyrics lookup was failing is shown but not cached, so a temporary lrclib outage can't record "no lyrics" for a song permanently.

**Limits** (constants at the top of `index.ts`): 30 requests per user per day, and 150 AI calls per day for the whole app, retries and backup-model calls included. Both are taken by `beatie_take_quota()` in single statements, so rapid requests can't get past them. Days reset at midnight UTC. Besides the backup model (below), there is never more than one automatic retry per request: once if an explanation or chat answer quotes too much of the lyrics, once if a translation's line count is off.

**Lyric safety:** explanations and chat may quote at most one lyric line (a line explanation, only the line being explained). An answer that quotes more is retried once with a stricter instruction, then not shown. Translations are exempt: they translate every line, and appear only on the Song page.

**Errors** come back as codes, and the app turns each into a friendly message, never a raw error: `limit` (this user's 30 are used), `global` ("Beatie is taking a break, try again later"), `busy` (the AI service down, rate-limited or too slow, or this answer failed in the last 2 minutes: "Beatie is taking a break, try again in a minute"), `pending` ("Beatie's still writing this one, check back in a moment"), `error` (anything else).

### The models

The live model is set by the Supabase secret **`GROQ_MODEL`** (default **`openai/gpt-oss-120b`**), and a backup by **`GROQ_FALLBACK_MODEL`** (default **`qwen/qwen3.8-27b`**). Both are read on every request, so `supabase secrets set` changes them with no redeploy.

**Backup:** when the main model is busy (HTTP 429 or 5xx, a timeout, a network failure, or a rate limit reported mid-answer) and at least 20 seconds of the budget remain (`MIN_RETRY_MS`), the same request is tried once on the backup model. That's an extra call, so it takes from the app-wide daily cap first (`takeQuota(null)`), like the other retries. Any other failure (a bad request, an unknown model name, an empty answer) is an `error` and doesn't try the backup. There's no Gemini fallback.

**Reasoning:** `gpt-oss` models get `reasoning_effort: "low"`; Qwen models get `reasoning_format: "hidden"`, so their reasoning never reaches the answer text. Both reason within the output limit, so they get 1,024 extra output tokens on top of each request's limit (`REASONING_HEADROOM` in `groq.ts`).

**JSON:** translations ask for JSON. Groq's JSON mode (`response_format: json_object`) only allows an object at the top, so the model is told to wrap the array as `{"items": [...]}`, and `groq.ts` unwraps it before returning, so `index.ts` still receives a plain array.

**Waiting:** every budget is measured from the moment the request arrives, before the song and lyrics are loaded. Explanations, line explanations and translations get 120 seconds in total (`REQUEST_BUDGET_MS` in `index.ts`), well inside Supabase's 150-second limit for a function: they're cached, and past 25 seconds they finish in the background while the user sees "check back", so nobody waits that long. Chat gets 40 seconds (`CHAT_BUDGET_MS`): it isn't cached and the user is waiting on it. A retry or a backup call only starts if at least 20 seconds of budget remain. In the app, "Beatie is thinking…" becomes "Still thinking… long songs take a moment" after 8 seconds.

**Finishing in the background:** a cacheable answer that isn't ready after 25 seconds (`RESPOND_WITHIN_MS`) is left to finish on the server (`EdgeRuntime.waitUntil`). The app shows "Beatie's still writing this one, check back in a moment" (code `pending`); the answer lands in the cache, and the next tap loads it free. While an answer is being written, its `beatie_cache` row exists with empty `content`: a claim, which the table's unique key lets only one request make, so the answer is asked of the AI service, and counted, once however many taps or people arrive meanwhile. A claim older than 3 minutes (`PENDING_STALE_MS`) means the background work died; it's cleared and the next tap starts again.

**Remembering failures:** when a job fails (the AI service down or too slow, or its answer rejected), its row holds the marker `__beatie_failed__` for 2 minutes (`FAILED_HOLD_MS`). Taps meanwhile get "Beatie is taking a break" without calling the AI service. A quota refusal (`limit`, `global`) just releases the claim, since it's about the user or the day, not the song.

**Answer checks:** before an answer is shown or cached it's rejected, with the reason logged, if it was cut off at the token limit (finish reason `length`), or, for explanations and chat, if it repeats a sentence 3+ times or a 6-word phrase 4+ times (`repetitionProblem` in `prompts.ts`). Translations skip the repetition check: songs repeat their chorus, so a faithful translation does too. These rejections aren't retried.

**Logs** (Supabase dashboard → Functions → beatie → Logs; never shown to users): every call is streamed and logged as `[beatie] groq <kind> <song> <language> try <n>: model=… finish=… thinking=<tokens> answer=<tokens> prompt=<tokens> ms=… firstChunkMs=… chars=…` (a backup call's label ends in `backup`). A call that runs out of time logs `gave up after <ms>` with the tokens so far and `last100=` the last ~100 characters received. Rejected answers log `[beatie] answer rejected (…): <reason>`; lyric-quote rejections give line numbers only.

**Deploying:** `supabase functions deploy beatie --use-api` (`--use-api` bundles on Supabase's side, so Docker isn't needed). The migration `0029_beatie.sql` must be applied first.

**Lyrics language** (for showing the Translate button) is detected in the browser without AI: by alphabet for Arabic and Hindi, and by how many very common English words a Latin-script text has.

## Artist genres — Wikidata, then MusicBrainz (no keys)

Each artist's genres come from **Wikidata's "genre" (P136)** on the item whose **Spotify artist ID (P1902)** matches, the same match the bio uses: by ID, never by name, so a band called "Low" can't pick up someone else's genres. English labels only. When Wikidata has none, **MusicBrainz**: the artist linked to `https://open.spotify.com/artist/<id>` (`/ws/2/url?resource=…&inc=artist-rels`), then that artist's genres (`/ws/2/artist/<mbid>?inc=genres+tags`), or its tags with at least 2 votes when it has no genres. Neither needs a key.

- **Rate limits.** MusicBrainz allows **1 request a second** and asks for a User-Agent naming the app and a contact; both the backfill and the function send `Beatboxed/1.0 (class project; https://github.com/AbrarAlmhari/BeatBoxed)` and wait 1.1s between calls. The Wikidata query service is asked 50 artists at a time with a pause between batches.
- **Stored per artist:** `genres_raw` (as the source gave them), `genres_source` (`wikidata` / `musicbrainz` / `none`) and `genres_fetched_at`. A miss is stamped `none`, so it isn't asked again.
- **Grouping** into the 16 buckets (Pop, Rock, Indie & Alternative, Hip-Hop & Rap, R&B & Soul, Electronic & Dance, Metal, Jazz & Blues, Classical, Country & Folk, Latin, K-Pop, Arabic, Khaleeji, South Asian, Other) happens in the database, from `genre_map` (exact names) and `genre_patterns` (LIKE patterns by priority), so editing those tables re-groups every artist at once. Unmatched names land in Other and are listed, with how many artists have each, in the `genre_unmapped` view: that's the list to extend the mapping from.
- **Back catalogue:** `node scripts/backfill-artist-genres.mjs` (only artists with at least one song; stop and re-run freely, it picks up where it left off; `--limit 50` for a trial). It prints a summary and the top unmapped genres.
- **New artists:** the artist page calls the `artist-genres` Edge Function the first time it's opened for an artist whose genres were never looked up. The function is deployed; redeploy it with `npx supabase functions deploy artist-genres` after changing it. If it can't run, the page just shows no genres for that artist.

## Auth emails and links (Supabase Auth + Vercel)

Sign-up confirmation, its resend, and password reset all send an email with a link back to the app. `src/lib/authLinks.ts` decides where:

- **In production** every link uses `VITE_SITE_URL` (set in Vercel, no trailing slash), so a link never points at an expired preview deployment or another address the app was opened on.
- **On localhost** it uses the local address, so testing comes back to the local app.

Supabase only follows a link to an address in **Authentication → URL Configuration → Redirect URLs**; anything else goes to the **Site URL** instead. The links are `<site>/welcome` (sign-up) and `<site>/reset-password` (reset). If a reset link lands somewhere else anyway (the Site URL's home page), the app moves it to `/reset-password`.

`vercel.json` sends every route to `index.html`, so refreshing a page or opening a direct link (`/welcome`, `/profile/…`) loads the app instead of Vercel's 404. Real files (scripts, images) are served first, so they're unaffected.

## Environment variables

See `.env.example` at the repo root. Real keys go in `.env.local` (gitignored), never committed.
