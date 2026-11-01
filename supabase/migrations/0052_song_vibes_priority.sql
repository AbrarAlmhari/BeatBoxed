-- The song labeller labels the songs people actually see first.
--
-- The queue's priorities were worked out once, in 0048, from what people
-- had done by then; songs reviewed, viewed or added to playlists since
-- never moved up. refresh_song_vibe_priorities() works them out again
-- from what people do now, and claim_song_vibes() calls it before handing
-- out each batch (every 10 minutes), so the order stays current. It takes
-- about 50 ms and only writes the songs whose priority changed.
--
-- Order, highest first (then, within one priority, oldest in the queue):
--   400  a current or past song of the week
--   300+ reviewed or rated (+1 per review, up to 399)
--   250  in any playlist
--   200  in Trending (the top 200 the rail and its full list draw from)
--   150  viewed in the last 30 days
--   120  could appear in someone's For You: by an artist someone follows,
--        or whose song someone reviewed or viewed
--    50  added to the catalogue after 0048 (as before)
--     0  the rest of the catalogue (as before)
--
-- Safe while the app is in use: two functions are added or replaced; no
-- table changes. Rollback:
-- supabase/rollbacks/0052_song_vibes_priority_rollback.sql

begin;

set local lock_timeout = '5s';

create or replace function public.refresh_song_vibe_priorities()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed int;
begin
  with trending as (
    select s.id from public.songs s
     order by s.popularity desc nulls last, s.cached_at desc, s.id
     limit 200
  ),
  rated as (select r.song_id, count(*)::int as n from public.reviews r group by r.song_id),
  listed as (select distinct p.song_id from public.playlist_songs p),
  weekly as (select distinct w.song_id from public.weekly_songs w),
  viewed as (
    select distinct v.song_id from public.song_views v
     where v.viewed_at > now() - interval '30 days'
  ),
  for_you_artists as (
    select f.artist_id from public.follows f
    union
    select s.artist_id from public.reviews r join public.songs s on s.id = r.song_id
    union
    select s.artist_id from public.song_views v join public.songs s on s.id = v.song_id
  ),
  wanted as (
    select q.song_id,
           case
             when wk.song_id is not null then 400
             when rt.song_id is not null then 300 + least(99, rt.n)
             when ls.song_id is not null then 250
             when tr.id is not null then 200
             when vw.song_id is not null then 150
             when fa.artist_id is not null then 120
             else least(q.priority, 50)
           end as priority
      from public.song_vibe_queue q
      join public.songs s on s.id = q.song_id
      left join weekly wk on wk.song_id = q.song_id
      left join rated rt on rt.song_id = q.song_id
      left join listed ls on ls.song_id = q.song_id
      left join trending tr on tr.id = q.song_id
      left join viewed vw on vw.song_id = q.song_id
      left join for_you_artists fa on fa.artist_id = s.artist_id
     where q.attempts < 5
  )
  update public.song_vibe_queue q
     set priority = w.priority
    from wanted w
   where w.song_id = q.song_id
     and q.priority is distinct from w.priority;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.refresh_song_vibe_priorities() from public;
revoke execute on function public.refresh_song_vibe_priorities() from anon, authenticated;
grant execute on function public.refresh_song_vibe_priorities() to service_role;

-- As in 0048, plus the refresh at the start.
create or replace function public.claim_song_vibes(batch_size int, daily_cap int)
returns table (
  song_id     uuid,
  title       text,
  artist_name text,
  duration_ms int,
  genre_group text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  today     date := (now() at time zone 'utc')::date;
  used      int;
  allowed   int;
  ids       uuid[];
begin
  -- Songs people see first: priorities follow what they do now.
  perform public.refresh_song_vibe_priorities();

  insert into public.song_vibe_usage (day, calls) values (today, 0) on conflict do nothing;
  select u.calls into used from public.song_vibe_usage u where u.day = today for update;
  allowed := greatest(0, least(coalesce(batch_size, 5), coalesce(daily_cap, 300) - used));
  if allowed = 0 then
    return;
  end if;

  select array_agg(q.song_id) into ids
    from (
      select q2.song_id
        from public.song_vibe_queue q2
       where q2.attempts < 5 and q2.next_try_at <= now()
       order by q2.priority desc, q2.enqueued_at
       limit allowed
       for update skip locked
    ) q;

  if ids is null then
    return;
  end if;

  update public.song_vibe_queue q
     set attempts = q.attempts + 1,
         next_try_at = now() + case q.attempts when 0 then interval '1 hour'
                                               when 1 then interval '6 hours'
                                               else interval '1 day' end
   where q.song_id = any (ids);

  update public.song_vibe_usage u set calls = u.calls + cardinality(ids) where u.day = today;

  return query
    select s.id,
           s.title,
           a.name,
           s.duration_ms,
           (public.artist_genre_buckets(a.genres_raw))[1]
      from public.songs s
      left join public.artists a on a.id = s.artist_id
     where s.id = any (ids);
end;
$$;

commit;
