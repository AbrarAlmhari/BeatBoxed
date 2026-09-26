# Beatboxed — Project Context for Claude Code

Read this file first in every session. It's the durable context for building Beatboxed so you don't have to re-derive it from scratch each time. Full rationale lives in `docs/`; this file is the quick-reference.

## What this is

Beatboxed is a web-based interactive music community app for a CSC 305 class project (team of 7). Core idea: users discover, rate, and review music, build custom profiles and playlists, and get AI-assisted lyrics explanation/translation from an in-app chatbot named **Beatie**. The rating/review system is the flagship feature.

Design (theme, color system, full mockups for every screen) is already finished — see `docs/design-system.md`. Nothing here should introduce a different visual style than what's specified there.

## Tech stack (do not deviate without updating this file)

- **Frontend:** React + TypeScript, Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Edge Functions)
- **Music metadata:** Spotify Web API, **Client Credentials flow only** — see `docs/api-integrations.md` for why (Spotify's Feb 2026 Developer Mode changes cap per-user auth at 5 accounts; app-level metadata access has no such cap)
- **Lyrics text:** lrclib.net (free, no auth, includes synced lyrics) — Genius is metadata/links only, never lyrics text (their ToS doesn't license it)
- **AI (Beatie):** Gemini API via a **Google AI Studio** API key (free tier) — this is a separate credential from any consumer Gemini subscription
- **Hosting:** Vercel (frontend) + Supabase (backend)
- **Version control:** Git + GitHub, PRs into `main`

## Feature scope — MVP first

Build in this order; do not start a stretch feature before the MVP list is fully working. Full detail in `docs/feature-map.md`.

**MVP:** auth, home feed, search (song/artist/lyrics), song page (about/lyrics/reviews tabs), rating & review system, user profile, library/playlists, settings, Beatie chatbot (contextual sheet on Now Playing, not a separate tab).

**Stretch (cut first if time is short):** friends/social graph, notification center, Spotify/Apple Music playlist import, genre-taste graph, mood-based recommendations, full multi-language UI translation, live Spotify account linking beyond the 5-user dev cap.

**Playback note:** build the Now Playing UI against real track metadata, but treat actual in-browser audio streaming as a limited-demo feature (requires listener-side Spotify Premium + counts against the 5-user cap) — don't block the MVP on it.

## Data model

See `docs/data-model.md` for the proposed Supabase schema (profiles, songs, artists, albums, playlists, playlist_songs, reviews, follows, notifications). **Treat this schema as locked once the team agrees on it in Week 1** — changing it after parallel build starts creates merge conflicts across everyone's slice. If a change is genuinely needed, flag it, don't just migrate silently.

Row Level Security: every table with user-owned rows (reviews, profiles, playlists) needs RLS policies scoped to the owning user from the start, not bolted on later.

## Team workstreams

See `docs/team-workstreams.md`. Each teammate owns a vertical slice (UI + the tables/routes it needs), not just a page. When working on a slice, respect the API contracts / shared types other slices depend on rather than changing them unilaterally.

## Environment variables

See `.env.example`. Never commit real keys. The Gemini key comes from Google AI Studio (not the consumer Gemini app), the Spotify credentials from a Spotify Developer Dashboard app in Client Credentials mode.

## Current status

Design: done. Development: starting now. See `docs/roadmap.md` for the day-by-day plan and `TASKS.md` for the live checklist — update `TASKS.md` as work completes rather than only tracking status verbally in chat.
