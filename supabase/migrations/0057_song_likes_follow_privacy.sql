-- Song likes follow the liker's privacy (0057). Until now anyone, signed in
-- or not, could read anyone's song likes straight from the table, even a
-- private account's, though the app hid the Likes tab. Now a like is
-- readable by its owner and by whoever may see the owner's profile
-- (public account, or an accepted follower), the same rule as reviews.
--
-- Nothing reads other people's song likes for counts or the feed (the feed
-- only reads your own), so no number in the app changes. Signed-out
-- visitors can no longer read song likes at all; no signed-out page uses
-- them. Undo with supabase/rollbacks/0057_song_likes_follow_privacy_rollback.sql.
begin;

set local lock_timeout = '5s';

drop policy if exists "Song likes are viewable by everyone" on public.song_likes;

create policy "Song likes follow the liker's privacy"
  on public.song_likes for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or public.can_view_profile((select auth.uid()), user_id)
  );

commit;
