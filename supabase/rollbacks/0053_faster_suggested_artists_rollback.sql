-- Undoes migrations/0053_faster_suggested_artists.sql: suggested_artists
-- goes back to its 0039 version (same results, slower). Run by hand only.
-- Nothing stored changes.
begin;

set local lock_timeout = '5s';

create or replace function public.suggested_artists(p_tags text[], p_limit int default 9)
returns table (
  id        uuid,
  name      text,
  image_url text,
  matched   boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with wanted as (select public.tag_buckets(p_tags) as buckets),
  candidates as (
    select a.id, a.name, a.image_url,
           (public.artist_genre_buckets(a.genres_raw) && w.buckets) as matched,
           (select count(*) from public.reviews r join public.songs s on s.id = r.song_id where s.artist_id = a.id) as ratings,
           (select coalesce(max(s.popularity), 0) from public.songs s where s.artist_id = a.id) as popularity
      from public.artists a
      cross join wanted w
     where exists (select 1 from public.songs s where s.artist_id = a.id)
  )
  select c.id, c.name, c.image_url, c.matched
    from candidates c
   order by c.matched desc, c.ratings desc, c.popularity desc, c.name
   limit least(greatest(coalesce(p_limit, 9), 1), 30)
$$;

commit;
