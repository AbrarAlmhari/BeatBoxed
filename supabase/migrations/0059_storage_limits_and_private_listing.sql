-- Image storage: a size limit and allowed types for both buckets, enforced by
-- the server, and logged-out visitors can no longer list the files. Images
-- still load through their public links, which don't use these policies.
-- Uploads that overwrite and deletes need a select policy, so each user keeps
-- one for their own folder. Rollback: supabase/rollbacks/0059_*.
begin;
update storage.buckets set file_size_limit = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'] where id = 'avatars';
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'] where id = 'playlist-covers';
drop policy "Avatar images are publicly readable" on storage.objects;
drop policy "Playlist covers are publicly readable" on storage.objects;
create policy "Users can read their own avatar files" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can read their own playlist cover files" on storage.objects for select to authenticated
  using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
