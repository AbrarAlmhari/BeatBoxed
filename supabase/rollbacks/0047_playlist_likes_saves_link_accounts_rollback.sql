-- Undoes migrations/0047_playlist_likes_saves_link_accounts.sql: points
-- user_id back at profiles, as 0045 had it. Nothing is lost.
--
-- WARNING: this brings back the ambiguous playlists-to-profiles link, so
-- any app code that embeds profiles(...) from playlists without naming
-- the foreign key will fail again. Only run it together with 0045's
-- rollback, or after pinning those embeds.
begin;

alter table public.playlist_likes drop constraint if exists playlist_likes_user_id_fkey;
alter table public.playlist_likes
  add constraint playlist_likes_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.playlist_saves drop constraint if exists playlist_saves_user_id_fkey;
alter table public.playlist_saves
  add constraint playlist_saves_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

notify pgrst, 'reload schema';

commit;
