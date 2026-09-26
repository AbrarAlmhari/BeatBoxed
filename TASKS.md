# Task Checklist

Keep this updated as the source of truth on progress — don't rely on chat history to know what's done.

## Week 1 — Foundation (Sept 26 – Oct 2)

- [ ] Team agrees on and locks the Supabase schema (`docs/data-model.md`)
- [x] Repo initialized from this scaffold; project runs locally
- [x] Design tokens (`docs/design-system.md`) implemented in Tailwind config
- [x] Responsive nav shell (phone bottom tabs / tablet+ sidebar) with placeholder pages
- [ ] Supabase project created; Auth wired up; RLS policies drafted for user-owned tables
      (project + client connected in `src/lib/supabase.ts`; Auth and RLS still to do)
- [ ] Spotify Developer app registered (Client Credentials); `.env.local` set up per teammate
- [ ] Google AI Studio Gemini key generated; stored as `GEMINI_API_KEY`
- [ ] Vercel project connected for preview deploys

## Week 2 — Parallel build (Oct 3 – Oct 9)

- [ ] Auth: login / create account working end to end
- [ ] Home feed (trending / for-you rails)
- [ ] Explore/Search (song, artist, lyrics filters)
- [ ] Song page (About / Lyrics / Reviews tabs)
- [ ] Rating & review system (5-star + written review)
- [ ] User profile (customization, stats, reviews/playlists tabs)
- [ ] Library (liked songs, playlists, followed artists)
- [ ] Playlist creation + detail view
- [ ] Settings (theme, translation language, log out)
- [ ] Beatie chatbot wired to Gemini + lrclib

## Week 3 — Integration & cuts (Oct 10 – Oct 12)

- [ ] All slices merged into one app
- [ ] Bug bash complete
- [ ] Stretch features formally kept or cut (see `docs/feature-map.md`)

## Final stretch (Oct 13 – Oct 15)

- [ ] Cross-browser/device test pass
- [ ] Deployed to Vercel + Supabase
- [ ] Supabase project pinged/warm before demo
- [ ] Demo script written
- [ ] Final documentation complete
