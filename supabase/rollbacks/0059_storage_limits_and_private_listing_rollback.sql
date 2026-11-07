-- Undoes 0059: no size or type limits, and anyone can list the files again.
begin;
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('avatars','playlist-covers');
drop policy "Users can read their own avatar files" on storage.objects;
drop policy "Users can read their own playlist cover files" on storage.objects;
create policy "Avatar images are publicly readable" on storage.objects for select to public using (bucket_id = 'avatars');
create policy "Playlist covers are publicly readable" on storage.objects for select to public using (bucket_id = 'playlist-covers');
commit;
