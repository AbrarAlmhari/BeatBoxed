-- Undoes migrations/0036_south_asian_genres.sql. Run by hand only.
-- Lost: nothing but the mapping rows; artists re-group back on read.
begin;

update public.genre_map set bucket = 'Other' where raw in ('bollywood', 'filmi');
delete from public.genre_patterns where bucket = 'South Asian';
delete from public.genre_buckets where name = 'South Asian';

commit;
