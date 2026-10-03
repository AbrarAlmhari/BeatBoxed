# Task Checklist

Keep this updated as the source of truth on progress — don't rely on chat history to know what's done.

**Real deadline: December 3.** (The original Oct 15 dates below were based on a wrong deadline and have been rescaled — corrected Sept 30.)

## Week 1 — Foundation (Sept 26 – Oct 2)

- [x] Team agrees on and locks the Supabase schema (`docs/data-model.md`)
- [x] Repo initialized from this scaffold; project runs locally
- [x] Design tokens (`docs/design-system.md`) implemented in Tailwind config
- [x] Supabase project created; Auth wired up; RLS policies drafted for user-owned tables
- [x] Spotify Developer app registered (Client Credentials); `.env.local` set up per teammate
- [x] Google AI Studio Gemini key generated; stored as `GEMINI_API_KEY`
- [x] Vercel project connected; deployed and reachable

## Weeks 2–3 — Core build, phase 1 (Oct 3 – Oct 16)

- [x] Auth: login / create account working end to end (email confirmation redirect fixed)
- [x] Home feed (trending / for-you rails) — wired to real Spotify-cached data, seeded catalog
- [x] Explore/Search (song, artist, lyrics filters) — wired to real data, search icon from Home
- [x] Song page (About / Lyrics / Reviews tabs)
- [x] Rating & review system (5-star + written review, edit/delete own review)

## Weeks 4–6 — Core build, phase 2 (Oct 17 – Nov 6)

- [ ] User profile (customization, stats, reviews/playlists tabs)
- [ ] Library (liked songs, playlists, followed artists)
- [ ] Playlist creation + detail view
- [ ] Settings (theme, translation language, log out, notification preferences — per-type on/off for likes, comments, friend activity, and Beatboxed updates, enforced inside the shared `notify()` helper; friends list visibility toggle — flips `profiles.friends_list_visible`)
- [ ] Beatie chatbot wired to Gemini + lrclib

## Week 7 — Polish pass + integration checkpoint (Nov 7 – Nov 13)

- [ ] Work through the Polish backlog below
- [ ] Click through the whole app end to end as one person — not per-feature — and note anything that feels inconsistent
- [ ] Confirm design-system consistency across every page (colors, spacing, type, transitions)

## Week 8 — Stretch features, if time allows (Nov 14 – Nov 20)

- [ ] Review `docs/feature-map.md` stretch list and decide what's worth pulling in now that there's runway: Friends page, Notification center, genre-taste graph, mood-based recommendations, etc.
- [ ] Formally keep or cut each one — update `docs/feature-map.md` with the decision

## Week 9 — Full integration & bug bash (Nov 21 – Nov 27)

- [ ] All slices merged into one app
- [ ] Bug bash complete
- [ ] Cross-browser/device test pass

## Final stretch (Nov 28 – Dec 3)

- [ ] Deployed to Vercel + Supabase, final check
- [ ] Supabase project pinged/warm before demo
- [ ] Demo script written
- [ ] Final documentation complete
- [ ] Buffer days — keep these actually empty, don't schedule work into them

## Polish backlog

Things worth revisiting once the whole app exists, not mid-build. Add to this as you notice something rather than stopping to fix it immediately (unless it's an actual bug, not a nice-to-have — fix those now).

- [ ] Light theme (needs a design pass with Ghadah first; `profiles.theme_preference` already exists)
- [ ] _(add items here as they come up)_
