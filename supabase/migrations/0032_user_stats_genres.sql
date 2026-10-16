-- The Stats tab's Top genres (Part C): get_user_stats() gains `genres`.
--
--   genres  one entry per bucket: genre, count (songs), average (rating),
--           artists (the 3 most rated artists in it), most songs first
--
-- A rated song counts toward each of its artist's genre buckets (at most 2,
-- from artist_genre_buckets() in 0031), and only when it was rated 3★ or
-- higher: the chart is about what someone likes. Artists with no genres
-- count toward none. Everything else returned is unchanged, and so is the
-- privacy check (can_view_profile).
--
-- Replaces the function from 0030 with the same signature and a superset of
-- its result. Undo with supabase/rollbacks/0032_user_stats_genres_rollback.sql,
-- which puts 0030's version back.
begin;

create or replace function public.get_user_stats(p_user_id uuid, p_range text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since  timestamptz;
  result jsonb;
begin
  if p_range is null or p_range not in ('all', 'year', '30d') then
    raise exception 'unknown range %', p_range using errcode = '22023';
  end if;

  if not public.can_view_profile(auth.uid(), p_user_id) then
    return null;
  end if;

  since := case p_range
    when 'year' then date_trunc('year', now())
    when '30d' then now() - interval '30 days'
  end;

  with rated as (
    select r.rating::int as rating, s.artist_id, al.release_date
      from public.reviews r
      join public.songs s on s.id = r.song_id
      left join public.albums al on al.id = s.album_id
     where r.user_id = p_user_id
       and r.rating between 1 and 5
       and (since is null or r.created_at >= since)
  ),
  -- A song counts toward each of its artist's genres (at most 2), and only
  -- when it was rated 3★ or higher: genres are about what someone likes.
  genre_rows as (
    select rated.rating, a.name as artist, b.bucket
      from rated
      join public.artists a on a.id = rated.artist_id
      cross join lateral unnest(public.artist_genre_buckets(a.genres_raw)) as b(bucket)
     where rated.rating >= 3
  )
  select jsonb_build_object(
    'total', (select count(*) from rated),
    'average', (select round(avg(rating)::numeric, 2) from rated),
    'artists', (select count(distinct artist_id) from rated),
    'spread', (
      select jsonb_agg(coalesce(x.c, 0) order by n)
        from generate_series(1, 5) as n
        left join (select rating, count(*) as c from rated group by rating) x on x.rating = n
    ),
    'top_artists', (
      select coalesce(jsonb_agg(t order by t.count desc, t.average desc, t.name), '[]'::jsonb)
        from (
          select a.id, a.name, a.image_url as photo, count(*) as count,
                 round(avg(rated.rating)::numeric, 2) as average
            from rated
            join public.artists a on a.id = rated.artist_id
           group by a.id, a.name, a.image_url
           order by count(*) desc, avg(rated.rating) desc, a.name
           limit 5
        ) t
    ),
    'decades', (
      select coalesce(jsonb_agg(jsonb_build_object('decade', x.d, 'count', x.c) order by x.d), '[]'::jsonb)
        from (
          select (extract(year from release_date)::int / 10) * 10 as d, count(*) as c
            from rated
           where release_date is not null
           group by 1
        ) x
    ),
    'genres', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'genre', g.bucket, 'count', g.c, 'average', g.average, 'artists', g.artists
             ) order by g.c desc, g.average desc, g.bucket), '[]'::jsonb)
        from (
          select gr.bucket, count(*) as c, round(avg(gr.rating)::numeric, 2) as average,
                 (select jsonb_agg(t.artist order by t.n desc, t.artist)
                    from (select g2.artist, count(*) as n
                            from genre_rows g2 where g2.bucket = gr.bucket
                           group by g2.artist
                           order by count(*) desc, g2.artist
                           limit 3) t) as artists
            from genre_rows gr
           group by gr.bucket
        ) g
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_user_stats(uuid, text) from public;
revoke execute on function public.get_user_stats(uuid, text) from anon;
grant execute on function public.get_user_stats(uuid, text) to authenticated;

commit;
