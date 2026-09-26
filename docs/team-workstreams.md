# Team Workstreams

Build-phase ownership follows each person's design-phase pages where possible — whoever designed a screen already knows its states and edge cases.

| Member | Design-phase pages | Build workstream (UI + its data/API needs) |
|---|---|---|
| Abrar | Playlist creation, Artist page | Playlists + artist metadata integration |
| Ghadah | Logo, Notification center | Notifications (stretch) + design-system consistency owner |
| Saja | Settings, Explore/Search | Search (song/artist/lyrics filters) + settings/preferences |
| Retaj | Song page, Chatbot page | Song detail page + Beatie chatbot integration (Gemini + lrclib) |
| Fatimah | Play page, Homepage | Now Playing UI + Home feed |
| Aseel (blue) | Profile page, Friends list | Profiles + social graph (follows/friends, stretch) |
| Aseel (red) | Login page, Review page | Auth (Supabase Auth) + rating/review system |
| Lead | — | Supabase schema, API contracts between slices, integration, deploy pipeline, unblocking |

## Working agreements

- The Supabase schema (`docs/data-model.md`) is locked after Week 1 — propose changes to the team, don't migrate silently.
- Each slice should be independently demoable against seeded/mock data before integration week.
- Daily 15-minute sync during the parallel-build phase to catch schema or contract drift early.
