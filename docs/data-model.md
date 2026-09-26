# Data Model (proposed — lock in Week 1)

This is a starting proposal for the Supabase/Postgres schema, sized to the MVP feature list. Treat it as a draft to be finalized by the team in the first work session, then locked — changes after parallel build starts should be flagged to everyone, not migrated silently.

## Core tables

- **profiles** — `id (uuid, fk auth.users)`, `username`, `display_name`, `avatar_url`, `bio`, `theme_preference`, `translation_language`, `created_at`
- **artists** — `id`, `spotify_id`, `name`, `image_url`, `genres` (cached from Spotify Client Credentials lookups, not a full mirror)
- **albums** — `id`, `spotify_id`, `title`, `artist_id (fk)`, `cover_url`, `release_date`
- **songs** — `id`, `spotify_id`, `title`, `artist_id (fk)`, `album_id (fk)`, `duration_ms`, `genre`
- **reviews** — `id`, `song_id (fk)`, `user_id (fk)`, `rating (1-5)`, `body`, `created_at`, `updated_at`, `edited (bool)`
- **playlists** — `id`, `user_id (fk)`, `title`, `description`, `cover_url`, `created_at`
- **playlist_songs** — `playlist_id (fk)`, `song_id (fk)`, `position`, `added_at`
- **follows** (artist follows) — `user_id (fk)`, `artist_id (fk)`
- **friendships** (mutual follows / social graph — stretch) — `user_id (fk)`, `friend_id (fk)`, `status (pending/accepted)`
- **notifications** (stretch) — `id`, `user_id (fk)`, `type`, `payload (jsonb)`, `read (bool)`, `created_at`

## Notes

- Cache Spotify/lrclib/Genius data on first lookup rather than syncing a full catalog — the free tiers and the class-project timeline don't support a background sync job.
- Every user-owned table (`profiles`, `reviews`, `playlists`) needs Row Level Security policies from the start: users can read public rows but only write/edit their own.
- `reviews.rating` doubles as the "5-star rating" feature and the review body — no separate ratings table needed unless the team wants to allow a rating without a written review (simple to add: nullable `body`).
