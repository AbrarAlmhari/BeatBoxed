-- Genre interests shown as chips on the profile header.
--
-- The vocabulary is not fixed here on purpose: the editor reuses the genre
-- list Explore already derives from the catalog (distinct songs.genre), so
-- there's only ever one genre vocabulary in the app.

alter table public.profiles add column if not exists favorite_genres text[];
