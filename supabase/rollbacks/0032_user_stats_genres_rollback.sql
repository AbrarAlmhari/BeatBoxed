-- Undoes migrations/0032_user_stats_genres.sql: puts get_user_stats() back
-- as 0030 defined it, without `genres`. Kept out of migrations/ on purpose.
-- Run it by hand, before 0031's rollback if both are being undone (this
-- version doesn't need 0031's functions).
--
-- Lost: nothing. Only a function changes.
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
