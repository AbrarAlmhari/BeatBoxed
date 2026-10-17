-- Fixes 0045: the playlist page couldn't load its owner.
--
-- playlist_likes and playlist_saves each pointed user_id at profiles and
-- playlist_id at playlists. That gave the API a second and third way from
-- playlists to profiles, so the app's request for a playlist with its
-- owner's profile was refused as ambiguous (PGRST201) and every playlist
-- page showed "Playlist not found", in every copy of the app, not only the
-- new one. Found by the tests right after 0045 was applied; both tables
-- were still empty.
--
-- user_id now points at auth.users instead, which the API doesn't expose,
-- so playlists reach profiles one way again. Deleting an account still
-- deletes its likes and saves (cascade from auth.users; deleting the
-- profile alone, which the app never does, now leaves them until the
-- account goes). Constraints on the two new tables only; no rows change.

alter table public.playlist_likes drop constraint if exists playlist_likes_user_id_fkey;
alter table public.playlist_likes
  add constraint playlist_likes_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.playlist_saves drop constraint if exists playlist_saves_user_id_fkey;
alter table public.playlist_saves
  add constraint playlist_saves_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- The API reads its picture of the schema afresh.
notify pgrst, 'reload schema';
