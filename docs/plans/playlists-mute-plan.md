# Plan: saving and liking playlists (#4), and muting people (#5)

Mockups: `docs/mockups/playlists-mute/` (5 phone screens). Branch: `feature/playlists-mute`.

## How playlists and their privacy work today

- `playlists`: `id`, `user_id`, `title`, `description`, `cover_url`, `created_at`, `updated_at` (kept current by triggers, including when songs are added, removed or reordered).
- `playlist_songs`: `playlist_id`, `song_id`, `position`, `added_at`; the pair is the primary key.
- **There is no per-playlist privacy.** A playlist is visible exactly when its owner's account is: the select policies (0022) call `can_view_profile(viewer, owner)`, so a private account's playlists are visible to the owner and approved followers only. Reads need a sign-in (0019).
- `playlist_count(user)` (0023) returns a profile's playlist count even when the rows are hidden.
- Nothing records likes or saves of playlists today.

## Migrations

All additive: new tables, new columns with defaults, new or replaced functions and policies. No existing row is updated or deleted. Each has a rollback in `supabase/rollbacks/`.

### 0045: playlist likes, saves and privacy

- `playlists.is_private boolean not null default false`: a playlist the owner keeps to themselves. Off for every existing playlist, so nothing changes until an owner turns it on.
- Visibility in one place: `playlist_visible_to(playlist, viewer)` (internal) and `can_view_playlist(playlist)` (for the caller). Visible = (not private or you own it) and you can see the owner's account (public, you, or an approved follower).
- The select policies on `playlists` and `playlist_songs` are replaced to use it, so a private playlist disappears for everyone but its owner, in the database and not only in the UI.
- `playlist_likes (user_id, playlist_id, created_at)`, one per person. Insert and delete your own, only on playlists you can see. Readable when you can see both the playlist and the account of the person who liked it (likes are public).
- `playlist_saves (user_id, playlist_id, created_at, last_opened_at)`, one per person. Insert, update (`last_opened_at`) and delete your own; insert only on playlists you can see. **Readable only by the saver**: owners never learn who saved.
- Notifications: type `playlist_liked` (grouped per playlist, like comment likes), a switch `notification_preferences.playlist_liked` (on by default), a unique index so like-unlike-like can't stack, and unliking removes the unread notification.
- Read functions, one request each: `playlist_social(playlist)` (like and save counts, liked/saved by me), `my_saved_playlists()` (the Saved tab: available ones with owner, counts and "N new songs"; unavailable ones as bare rows), `liked_playlists(user)` (the profile Likes tab), `open_saved_playlist(playlist)` (stamps `last_opened_at`).
- `playlist_count()` keeps counting the owner's playlists but leaves out private ones for everyone but the owner.

### 0046: muting

- `user_mutes (muter_id, muted_id, created_at)`, one per pair, never yourself. **Read, add and remove only your own mutes** (`muter_id = auth.uid()`); the muted person can never read a row about them.
- `has_muted(muter, muted)` (internal) is the one check everything else calls.

## Every place muting is checked

Database (so it holds for the API, not only the app):

1. `notify()`: no notification of any type when the recipient muted the actor. Covers review likes, comments, replies, thread replies, mentions, comment likes, playlist likes, follows, follow requests and accepted follows.
2. `comment_notification_recipients()`: drops anyone who muted the commenter or liker (as planned in conversations).
3. `mention_suggestions()`: never suggests someone you muted.
4. `feed_for_you()`: leaves out reviews by people you muted.
5. `feed_following()`: the same.
6. `suggested_reviewers()` (the empty Following tab): never suggests someone you muted.
7. `suggested_reviewers_for_tags()` (setup step 4): the same.
8. `review_previews()`: the top comment, the commenter avatars and the "Liked by" avatars skip people you muted.

App (the lists that read tables directly; the database functions above cover the rest):

9. Song page reviews (`getSongReviews`): reviews by muted people are left out.
10. Profile Likes tab (reviews you liked): the same, for the signed-in person's own lists.
11. Comment threads: comments and replies by muted people fold into "Comment from someone you muted · Show" / "Hide again". The thread keeps its shape.
12. Notifications page and bell: notifications from muted people that already existed before the mute are hidden too.
13. The muted person's own profile still shows their reviews (that's where you'd go to check), with the "You muted @name" banner.

Not changed by a mute: follows (in either direction), what the muted person can see, their own view of anything.

## Screens that change

- **Playlist page (someone else's):** 2x2 cover mosaic from the first four songs with a glow from their colours, owner with avatar, song count and length, "Liked by N · Saved by N", the Like pill and Save button, Shuffle and Play. The toast "Saved to your Library · View".
- **Playlist page (your own):** counts only, no Like or Save; a "Private playlist" switch in its ⋯ menu.
- **Library:** tabs Mine · Saved · Liked songs (· Artists, kept). Saved lists saved playlists with the owner, "N new songs", and unavailable rows with Remove.
- **Profile Likes tab:** a Playlists section.
- **Profile ⋯ menu:** Mute / Unmute; the confirm sheet with the four lines; the banner "You muted @name. Only you can see this." with Unmute, then "Unmuted. Their posts will show again."
- **Review ⋯ and comment ⋯:** Mute @name.
- **Settings → Muted accounts:** the list, Unmute/Mute toggles, empty state.
- **Settings → Notifications:** the new "Likes on your playlists" switch.
- **Toasts:** "Muted @name. Manage muted accounts in Settings."
