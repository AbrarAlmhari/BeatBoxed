# Data Model (proposed — lock in Week 1)

This is a starting proposal for the Supabase/Postgres schema, sized to the MVP feature list. Treat it as a draft to be finalized by the team in the first work session, then locked — changes after parallel build starts should be flagged to everyone, not migrated silently.

## Core tables

- **profiles** — `id (uuid, fk auth.users)`, `username`, `display_name`, `avatar_url`, `bio`, `theme_preference`, `translation_language`, `created_at`
- **artists** — `id`, `spotify_id`, `name`, `image_url`, `genres` (cached from Spotify Client Credentials lookups, not a full mirror)
- **albums** — `id`, `spotify_id`, `title`, `artist_id (fk)`, `cover_url`, `release_date`
- **songs** — `id`, `spotify_id`, `title`, `artist_id (fk)`, `album_id (fk)`, `duration_ms`, `genre`, `popularity` (nullable; Deezer rank, see note below)
- **reviews** — `id`, `song_id (fk)`, `user_id (fk)`, `rating (1-5)`, `title`, `body`, `created_at`, `updated_at`, `edited (bool)` — unique on `(song_id, user_id)`: one review per user per song, so writes are edit-or-create
- **review_likes** — `review_id (fk, cascade)`, `user_id (fk, cascade)`, `created_at` — primary key `(review_id, user_id)`, so a like is binary and can't be duplicated
- **review_comments** — `id`, `review_id (fk, cascade)`, `user_id (fk, cascade)`, `body (not null)`, `created_at`, `updated_at`, `edited (bool)`
- **song_views** — `user_id (fk, cascade)`, `song_id (fk, cascade)`, `viewed_at` — primary key `(user_id, song_id)`, so a revisit updates the timestamp rather than adding a row. Seeds Home's For You rail.
- **playlists** — `id`, `user_id (fk)`, `title`, `description`, `cover_url`, `created_at`
- **playlist_songs** — `playlist_id (fk)`, `song_id (fk)`, `position`, `added_at`
- **follows** (artist follows) — `user_id (fk)`, `artist_id (fk)`
- **friendships** — `user_id (fk, requester)`, `friend_id (fk, recipient)`, `status (pending/accepted)`, `created_at` — unique on the ordered pair, with a check constraint blocking self-requests. **Private**: only the two people in a row can select it, unlike `follows`. Insert as `user_id` only; only the recipient may update to `accepted`; either side may delete (cancel / decline / unfriend). Requesting someone who already requested you is an accept, handled atomically by the `request_friendship(target)` RPC.
- **notifications** — `id`, `user_id (fk)`, `type`, `payload (jsonb)`, `read (bool)`, `created_at`. Types today: `friend_accepted`, `review_liked`, `review_commented`, `thread_reply`. Every row is written by a trigger calling the shared `notify(recipient_id, actor_id, type, payload)` helper, which drops the case where recipient = actor, so nobody is told about their own action. A new social type is a trigger plus one renderer. A partial unique index keeps one `review_liked` row per (recipient, actor, review), so like -> unlike -> like can't stack duplicates. Un-liking or deleting a comment removes the matching notification **only while it is still unread** — pulling something already seen is more confusing than leaving it. **No insert policy at all**: rows come only from database triggers (security definer) or the service role, so nobody can push a fake notification to someone else. Payloads hold ids only, never names, so the UI resolves the current name at render and a rename can't leave stale text. Pending friend requests are *not* stored here — the bell reads them live from `friendships`, so cancelling or declining elsewhere clears them with nothing to sync. A trigger on `friendships` inserts `friend_accepted` for the requester when a request is accepted.
- **announcements** — `id`, `title`, `body`, `link` (nullable), `created_at`. Readable by any signed-in user; **writes are service-role only** and there is no admin UI — the team posts one from the Supabase SQL editor (the insert statement is documented in `supabase/migrations/0013_notifications.sql`).
- **announcement_reads** — `user_id (fk, cascade)`, `announcement_id (fk, cascade)`, `read_at` — primary key on the pair. Per-user read state, so an announcement isn't copied into every user's notifications.

## Notes

- Cache Spotify/lrclib/Genius data on first lookup rather than syncing a full catalog — the free tiers and the class-project timeline don't support a background sync job.
- `profiles.username` is unique **case-insensitively** (`profiles_username_lower_key`). The original constraint was case-sensitive, so `fara7` and `FARA7` could have coexisted.
- `song_views` and `friendships` are the tables that are **not** world-readable: browsing history is private, so even its select policy is scoped to the owner. Everything else below follows the read-public/write-own pattern.
- Every user-owned table (`profiles`, `reviews`, `review_likes`, `review_comments`, `playlists`) needs Row Level Security policies from the start: users can read public rows but only write/edit their own. Likes have no update policy — a like is binary, so it's insert or delete.
- `reviews.rating` doubles as the "5-star rating" feature and the review body — no separate ratings table needed. `title` and `body` are both nullable, so a rating-only review is valid.
- `songs.popularity` holds Deezer's `rank`, written when a row is cached. Spotify withholds its own `popularity` from this app — it's absent from search, from `/v1/tracks/{id}`, and from album tracks, and the batch endpoint is 403 — and every chart route is blocked too (editorial playlists 404/403, `/browse/*` 403, playlist track listings 403). Deezer's public API needs no key. It's matched on title + artist strings rather than an id, so it stays nullable: an unmatched track sorts last rather than being ranked zero.
- The catalog tables (`artists`, `albums`, `songs`) also carry `cached_at`, set when a row is written by the `spotify-search` Edge Function. It's what Home's Trending rail falls back to before any reviews exist.
