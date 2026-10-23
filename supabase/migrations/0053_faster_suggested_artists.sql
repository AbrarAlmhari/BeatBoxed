-- Onboarding's "Suggested artists" loads in well under a second again.
--
-- The 0039 version counted reviews and found the top song popularity with
-- a separate lookup per artist, and worked out each artist's genre groups
-- by matching every one of their genre tags against the pattern list, one
-- artist at a time. With about 4,000 artists that took 3.5 to 6 seconds,
-- close to the 8-second limit for signed-in requests, and the list came
-- back empty when it ran out of time.
--
-- This version does each step once for all artists: counts and
-- popularity grouped by artist, and each distinct genre tag (about 400)
-- matched once. The rule is unchanged: an artist matches when one of
-- their top two genre groups (not 'Other') is among the picked tags'
-- groups; then most reviewed, most popular, name. Checked against the old
-- version for several tag picks: the same artists in the same order, in
-- 0.5 to 1.1 seconds instead of 3.3 to 6.
--
-- Still security invoker: reviews hidden from the person by privacy rules
-- still don't count, as before. Same name, arguments and result, so the
-- app and the existing grants are unchanged.
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
  -- Only artists with a song in the catalogue, with their most popular one.
  song_stats as (
    select s.artist_id, max(coalesce(s.popularity, 0)) as popularity
      from public.songs s
     where s.artist_id is not null
     group by s.artist_id
  ),
  rating_stats as (
    select s.artist_id, count(*) as ratings
      from public.reviews r
      join public.songs s on s.id = r.song_id
     group by s.artist_id
  ),
  artist_tags as materialized (
    select ss.artist_id, g.raw
      from song_stats ss
      join public.artists a on a.id = ss.artist_id
      cross join lateral unnest(coalesce(a.genres_raw, '{}')) as g(raw)
  ),
  -- Each distinct tag's group, worked out once (genre_bucket_of's rule).
  tag_map as materialized (
    select d.raw,
           coalesce(
             (select gm.bucket from public.genre_map gm where gm.raw = lower(trim(d.raw))),
             (select p.bucket from public.genre_patterns p
               where lower(trim(d.raw)) like p.pattern
               order by p.priority limit 1),
             'Other'
           ) as bucket
      from (select distinct raw from artist_tags) d
  ),
  -- Each artist's top two groups (artist_genre_buckets' rule).
  top_buckets as (
    select x.artist_id, x.bucket
      from (select t.artist_id, m.bucket,
                   row_number() over (partition by t.artist_id order by count(*) desc, b.priority) as rn
              from artist_tags t
              join tag_map m on m.raw = t.raw
              join public.genre_buckets b on b.name = m.bucket
             where m.bucket <> 'Other'
             group by t.artist_id, m.bucket, b.priority) x
     where x.rn <= 2
  ),
  matches as (
    select distinct tb.artist_id
      from top_buckets tb
      cross join wanted w
     where tb.bucket = any(w.buckets)
  )
  select a.id, a.name, a.image_url, (m.artist_id is not null) as matched
    from song_stats ss
    join public.artists a on a.id = ss.artist_id
    left join rating_stats rs on rs.artist_id = a.id
    left join matches m on m.artist_id = a.id
   order by (m.artist_id is not null) desc, coalesce(rs.ratings, 0) desc, ss.popularity desc, a.name
   limit least(greatest(coalesce(p_limit, 9), 1), 30)
$$;

commit;
