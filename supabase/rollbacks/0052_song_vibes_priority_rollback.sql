-- Undoes migrations/0052_song_vibes_priority.sql: claim_song_vibes goes
-- back to its 0048 version and the refresh function is dropped. Run by
-- hand only.
--
-- The priorities already rewritten stay as they are (they only change the
-- order songs are labelled in); new songs still join at 50, as before.
begin;

set local lock_timeout = '5s';

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

drop function if exists public.refresh_song_vibe_priorities();

commit;
