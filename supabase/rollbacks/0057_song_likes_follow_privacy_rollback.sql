-- Undoes migrations/0057_song_likes_follow_privacy.sql. Run by hand only.
-- Lost: nothing; song likes are readable by everyone again.
begin;

set local lock_timeout = '5s';

drop policy if exists "Song likes follow the liker's privacy" on public.song_likes;

create policy "Song likes are viewable by everyone"
  on public.song_likes for select
  to public
  using (true);

commit;
