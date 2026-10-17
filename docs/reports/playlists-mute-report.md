# Morning report: saving and liking playlists (#4), and muting people (#5)

Branch `feature/playlists-mute`, from `main` after the conversations merge. Everything is committed locally and **nothing is pushed**. The dev server is running at http://localhost:5173.

**One thing to know first:** for about 15 minutes overnight, **playlist pages were broken for every copy of the app** (this branch and `main`). The cause and fix are in "Migrations applied" below. It's fixed and checked.

## 1. Test results

**Baseline, before any code** (a clean copy of `main`): **256 passed, 1 failed, 1 skipped.**
- **Failed:** the mobile song-search test "a single artist name still returns their songs". The search came back empty. That's existing behaviour, unrelated to tonight's work, and I didn't touch it.
- **Skipped:** the desktop-only conversations test, which is skipped on mobile by design.
- My first baseline attempt measured the wrong thing: it ran from the working folder, which already contained my unfinished code. So I threw it away and reran from a separate clean copy of `main`.

**While working (desktop only):**
- the 8 new playlist and mute tests
- the related existing tests: playlists, playlist covers, profile playlists, profile, feed, conversations, settings, user follows

All passed after the fixes listed below.

**Final full suite:** **263 passed, 3 failed, 7 didn't run, 1 skipped.** All 3 failures turned out to be one-off hiccups:
- **The new playlists-mute tests on desktop:** Supabase's servers returned an error page (520) while the first test was setting up its accounts. That test failed, and the 7 after it in the same file didn't run. The same 8 tests passed on mobile in that run, and **all 8 passed on desktop when I reran them**.
- **Two search tests** ("matches partial words while typing" on desktop, and "finds a song from its title and artist in either order" on mobile) got no results once. **All 8 search tests passed on both layouts when rerun.** Search also had a one-off failure in the baseline, so it's a known flaky area, not something tonight's work changed.
- **The skip:** the desktop-only conversations test on mobile, as in the baseline.

## 2. Migrations applied

All three are applied to the live database. Each is additive and has a rollback in `supabase/rollbacks/` that I read through before applying.

| Migration | What it changes | Rollback |
|---|---|---|
| **0045** playlist likes, saves and privacy | **New tables:** `playlist_likes` (public) and `playlist_saves` (private, with "last opened").<br>**New column:** `playlists.is_private`, off for every existing playlist.<br>**Read rules:** replaced on `playlists` and `playlist_songs`, so a private playlist is visible only to its owner.<br>**Notifications:** "liked your playlist", with its own switch, grouped per playlist.<br>**Functions:** for the page's counts, Library's Saved tab and a profile's liked playlists. `playlist_count` leaves private playlists out for others. | Restores the old read rules, the old `notify()`, unread counts and playlist count, and removes the new tables and column. **Note:** this would make private playlists visible again to anyone who can see the owner's account. |
| **0046** muting | **New table:** `user_mutes`; only the person who muted can read, add or remove a row.<br>**One internal check:** `has_muted()`.<br>**Updated functions:** `notify()`, `comment_notification_recipients()`, `mention_suggestions()`, `review_previews()`, the two feeds, both suggested-people functions and the unread counts, so all of them leave muted people out. | Restores all 9 functions exactly as they were (I compared them line by line), then removes the table. |
| **0047** fix for 0045 | Points the new tables' user link at the sign-in accounts table instead of profiles. | Points it back, with a warning that this re-creates the problem. |

**What 0047 fixed:**
- **The problem:** 0045's new tables linked playlists to profiles a second way. The database's web layer then refused the app's request to "load a playlist with its owner" as ambiguous, and **every playlist page showed "Playlist not found"**. That includes `main`, if it's deployed anywhere.
- **How I found it:** the first new test, a few minutes after applying 0045.
- **The fix:** with 0047 applied, both `main`'s request and the new one work again (I checked both directly).
- **Belt and braces:** the new code also names the link explicitly, so this can't recur.
- **No data affected:** the new tables were empty at the time.

## 3. Live checks

These ran against the live database right after applying, with 6 throwaway accounts that were deleted afterwards. **52 of 52 passed** in the final run.

The first run had one failure, and it was my script's mistake. It expected an outsider to see a playlist count of 2 for an account with one private and one public playlist; the database correctly said 1. I fixed the expectation and added the owner's side (2).

**The muted person can't tell:**
- They read no mute rows: not about themselves, not at all.
- `has_muted` can't be called through the API, logged out or signed in.
- They can't remove someone else's mute, and nobody can mute as someone else or mute themselves.
- Their own feed is unchanged.
- They can still read your profile and reviews, and still follow you.

**Every notification type is blocked:**
- A muted person liked your review, commented, replied to your comment, mentioned you, liked your comment, liked your playlist, followed you and replied in your thread. **Zero notifications arrived.**
- Someone not muted doing the same things triggered all 7 types.
- After unmuting, their notifications arrive again.

**Mutes change nothing else:**
- The follow stays.
- They disappear from For You, Following, mention suggestions, suggested reviewers, "Liked by" and the comment preview, for you only.

**Playlist privacy:**
- An outsider can't like or save a private account's playlist; an approved follower can.
- Nobody but the owner can like, save, see or list the songs of a private playlist.
- The playlist count leaves private ones out for others.
- Nobody can like as someone else.

**Likes:**
- Each like tells the owner, and two likes count as one group.
- Unliking removes the unread notification, and like-unlike-like leaves one notification.
- The "Likes on your playlists" switch stops them.

**Saves:**
- The owner can't see who saved, only the totals, and saving sends no notification.
- "1 new song" appears after the owner adds one, the saved copy follows the original, and opening it clears the count.
- Made private: the row stays as unavailable, with nothing about the playlist in it, and can be removed.
- Deleted: the row disappears.
- A private account's playlist doesn't show in someone's likes to outsiders.

## 4. Commits (local, not pushed)

```
00376c9 fix(mute): one back arrow on Muted accounts
87bd4fb docs: playlist likes, saves and privacy, and muting
d80c6cf test(e2e): playlists and muting; Library's own playlists are Mine
369a7ff feat(mute): mute from a profile, a review or a comment
b41bd96 feat(playlists): like and save other people's playlists
bd455a7 fix(db): playlist pages load again after the likes and saves tables
75a9484 feat(db): muting
3b1c470 feat(db): like and save other people's playlists, and private playlists
29933f8 docs: plan for saving and liking playlists, and muting people
```

## 5. Decisions I made, and what's waiting for you

**Nothing is waiting for your approval.** Every migration met your conditions.

Decisions:
1. **Per-playlist privacy is new.** Playlists had no "private" setting of their own; they followed the account's privacy. Since you described an owner making a playlist private, I added a **Make private / Make public** button on your own playlist. Every existing playlist starts public.
2. **Library tabs are Mine · Saved · Liked songs · Artists.** I kept Artists so no existing feature disappears. Library now opens on Mine (it used to open on Liked songs). The tabs use the app's existing underline style, not the mockup's pill style, to stay consistent.
3. **An unavailable saved playlist shows no title.** It just says "No longer available. The owner made it private." with Remove, so nothing about a playlist the owner hid leaks out.
4. **Follow requests from a muted person still appear on your Follow requests page.** Muting must not stop someone following you, and a private account has to answer requests. Notifications about them are blocked as usual.
5. **Notifications that arrived before a mute are hidden too:** in the list, the bell and the filter counts.
6. **The song page's review count and the review's comment count still include muted people.** Only the content is hidden; the totals don't change.
7. **The ⋯ menu exists in four places:** on comments, on other people's reviews on the song page, on reviews in the feed and profile (next to Report), and on profiles. Each has Mute.
8. **Mockup 4 shows the moment right after unmuting**, a green "Unmuted. Their posts will show again." I built both states: "You muted @name. Only you can see this." with Unmute, then the green line.
9. **Report profile is left out**, as you asked.

## 6. How to test in the morning

Use two real accounts, A and B (not `@beatboxed.test` ones; the tests delete those).

1. **Like and save:**
   - B opens one of A's playlists, taps the heart, then Save.
   - The "Saved to your Library" toast appears; tap View, and Library opens on Saved.
   - A gets "B liked your playlist". A's own playlist shows "Liked by 1 · Saved by 1" but no Like or Save buttons.
2. **New songs:** A adds a song to that playlist. B's Library → Saved shows "1 new song". Opening it clears it.
3. **Private playlist:**
   - A taps Make private.
   - B's Saved row becomes "No longer available. The owner made it private." with Remove, and the link no longer opens it.
   - A taps Make public, and it's back.
4. **Mute:**
   - A opens B's profile → ⋯ → Mute @B. Read the four lines, then tap Mute.
   - The toast appears, and the profile shows "You muted @B. Only you can see this."
   - B's reviews disappear from A's Home.
   - B's comments show as "Comment from someone you muted · Show" for A.
5. **No notifications:** while muted, B likes, comments on and mentions A. A gets nothing. B sees no difference anywhere.
6. **Settings → Privacy → Muted accounts** lists B with "muted just now". Unmute, then Mute, toggles it.
7. **Unmute** from B's profile: the green "Unmuted" line appears, and B's reviews come back.

## 7. Screenshots

Open `Downloads/beatboxed-screenshots/playlists-mute/index.html`. Each row puts the mockup beside the built screen on a phone, a small phone (360px) and desktop.

Besides the five mockup screens (plus Library's Mine tab and the after-unmute state), it includes the extras you asked for:
- your own playlist (counts only)
- an unavailable saved playlist (in the Saved screen)
- Home after muting, with the muted person's review gone
- a folded muted comment
- the empty muted list
