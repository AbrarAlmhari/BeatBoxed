-- Undoes migrations/0031_artist_genres.sql. Kept out of migrations/ on
-- purpose: replaying that folder in order would otherwise undo 0031 right
-- after it. Run 0032's rollback first: 0032's get_user_stats() calls
-- artist_genre_buckets(). Revert the frontend too (the artist page, the
-- Stats tab and the profile header read genres).
--
-- Lost: every artist's fetched genres (genres_raw, genres_source,
-- genres_fetched_at) and any edits made to the mapping tables. The backfill
-- script can fetch the genres again.
begin;

drop view if exists public.genre_unmapped;
drop function if exists public.genre_buckets(public.artists);
drop function if exists public.artist_genre_buckets(text[]);
drop function if exists public.genre_bucket_of(text);
drop table if exists public.genre_patterns;
drop table if exists public.genre_map;
drop table if exists public.genre_buckets;

alter table public.artists drop column if exists genres_fetched_at;
alter table public.artists drop column if exists genres_source;
alter table public.artists drop column if exists genres_raw;

commit;
