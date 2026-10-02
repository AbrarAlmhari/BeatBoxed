-- Custom playlist covers.
--
-- Same shape as 0008_avatars_storage.sql: a public bucket so cover_url can be
-- a plain URL that renders without a signed request, and writes scoped by
-- path to playlist-covers/{user_id}/… so nobody can overwrite someone else's.
--
-- Ownership is enforced by the first path segment, exactly as for avatars.
-- That is deliberately the user's id and not the playlist's: storage policies
-- can't reach into public.playlists to check who owns a row, and a path keyed
-- on the playlist id alone would let anyone write any playlist's cover. The
-- playlist id is the filename instead, which keeps one cover per playlist and
-- makes a replacement overwrite the old file rather than accumulate.

insert into storage.buckets (id, name, public)
values ('playlist-covers', 'playlist-covers', true)
on conflict (id) do nothing;

-- Playlists appear on profiles, so their covers are read the same way avatars
-- are: public, no signed request.
drop policy if exists "Playlist covers are publicly readable" on storage.objects;
create policy "Playlist covers are publicly readable"
  on storage.objects for select
  using (bucket_id = 'playlist-covers');

drop policy if exists "Users can upload their own playlist covers" on storage.objects;
create policy "Users can upload their own playlist covers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'playlist-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can replace their own playlist covers" on storage.objects;
create policy "Users can replace their own playlist covers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'playlist-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own playlist covers" on storage.objects;
create policy "Users can delete their own playlist covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'playlist-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
