-- Song labels, the daily mood check-in (#9) and the song of the week (#10).
--
-- Additive. New tables, new functions, one new trigger on songs, the
-- pg_cron and pg_net extensions, one Vault secret and one cron job. No
-- existing row is changed; existing songs are only added to the new
-- labelling queue.
--
--   new tables     song_vibes, song_vibe_queue, song_vibe_usage,
--                  mood_checkins, weekly_songs
--   songs          + trigger: a newly added song joins the queue
--   read, not changed: reviews, song_likes, song_views, playlist_songs,
--                  follows, user_follows, user_mutes, profiles, artists,
--                  albums; can_view_profile(), tag_buckets(),
--                  artist_genre_buckets()

-- ===========================================================================
-- 1. Song labels
-- ===========================================================================

-- One row per labelled song, written only by the song-vibes function (the
-- service role). Below 0.6 confidence a label exists but is never used.
create table if not exists public.song_vibes (
  song_id     uuid primary key references public.songs(id) on delete cascade,
  lyrics_mood text not null check (lyrics_mood in ('sad', 'happy', 'nostalgic', 'romantic', 'angry', 'none')),
  energy      text not null check (energy in ('low', 'mid', 'high')),
  confidence  real not null check (confidence >= 0 and confidence <= 1),
  has_lyrics  boolean not null,
  model       text not null,
  labelled_at timestamptz not null default now()
);

create index if not exists song_vibes_pick_idx
  on public.song_vibes (lyrics_mood, energy)
  where confidence >= 0.6;

alter table public.song_vibes enable row level security;

drop policy if exists "Signed-in users read song labels" on public.song_vibes;
create policy "Signed-in users read song labels"
  on public.song_vibes for select
  to authenticated
  using (true);
-- No insert, update or delete policies: only the service role writes.

-- Waiting to be labelled. Highest priority first: songs people rated,
-- liked, opened or put in playlists, and Trending, then newly added songs,
-- then the rest of the catalogue.
create table if not exists public.song_vibe_queue (
  song_id     uuid primary key references public.songs(id) on delete cascade,
  priority    int not null default 0,
  enqueued_at timestamptz not null default now(),
  attempts    int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error  text
);

create index if not exists song_vibe_queue_next_idx
  on public.song_vibe_queue (priority desc, enqueued_at)
  where attempts < 5;

alter table public.song_vibe_queue enable row level security;
-- No policies at all: only the service role reads or writes the queue.

-- Calls made per day (UTC), so the daily cap counts failures too.
create table if not exists public.song_vibe_usage (
  day   date primary key,
  calls int not null default 0
);

alter table public.song_vibe_usage enable row level security;

-- A song added later joins the queue, above the untouched back catalogue
-- (someone searched or opened it to bring it in).
--
-- Never allowed to make the song's own insert fail: a duplicate is
-- skipped, and any other error is caught and logged, and the song saves
-- anyway (it can be queued later).
create or replace function public.queue_new_song()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.song_vibe_queue (song_id, priority)
    values (new.id, 50)
    on conflict do nothing;
  exception when others then
    raise warning 'song_vibe_queue: could not queue song %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.queue_new_song() from public;
revoke execute on function public.queue_new_song() from anon;
revoke execute on function public.queue_new_song() from authenticated;

drop trigger if exists songs_queue_vibe on public.songs;
create trigger songs_queue_vibe
  after insert on public.songs
  for each row execute function public.queue_new_song();

-- The existing catalogue, interacted-with songs first. Interaction counts
-- order them among themselves; the top 300 of Trending count as
-- interacted with.
with trending as (
  select id from public.songs
   order by popularity desc nulls last, cached_at desc
   limit 300
),
touched as (
  select s.id,
         (select count(*) from public.reviews r where r.song_id = s.id) as reviews,
         (select count(*) from public.song_likes l where l.song_id = s.id) as likes,
         (select count(*) from public.song_views v where v.song_id = s.id) as views,
         (select count(*) from public.playlist_songs p where p.song_id = s.id) as listed,
         exists (select 1 from trending t where t.id = s.id) as is_trending
    from public.songs s
)
insert into public.song_vibe_queue (song_id, priority)
select id,
       case
         when reviews + likes + views + listed > 0 or is_trending
           then 100 + least(100, (reviews * 5 + likes * 3 + listed * 2 + views)::int)
         else 0
       end
  from touched
on conflict do nothing;

-- The next batch for the function, within the daily cap. Claimed rows get
-- their attempt counted and their next try set now, so a run that dies
-- halfway leaves them to retry later rather than stuck: 1 hour after the
-- first attempt, 6 hours after the second, a day after that; 5 at most.
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

revoke all on function public.claim_song_vibes(int, int) from public;
revoke execute on function public.claim_song_vibes(int, int) from anon;
revoke execute on function public.claim_song_vibes(int, int) from authenticated;

-- ===========================================================================
-- 2. The scheduler, protected by a private secret
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A random secret made inside the database: it never appears in a file.
-- The cron job sends it; the function asks song_vibes_secret_ok() before
-- doing anything. The public key alone can't start a labelling run.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'song_vibes_cron') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'song_vibes_cron',
      'Sent by the song-vibes cron job; checked by the function.'
    );
  end if;
end
$$;

create or replace function public.song_vibes_secret_ok(candidate text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select candidate is not null
     and length(candidate) >= 32
     and candidate = (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'song_vibes_cron');
$$;

revoke all on function public.song_vibes_secret_ok(text) from public;
revoke execute on function public.song_vibes_secret_ok(text) from anon;
revoke execute on function public.song_vibes_secret_ok(text) from authenticated;

-- Every 10 minutes: one batch. The function stops for the day at its cap.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'song-vibes-label') then
    perform cron.unschedule('song-vibes-label');
  end if;
end
$$;

select cron.schedule(
  'song-vibes-label',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://amalwycmucybcjxzhhoz.supabase.co/functions/v1/song-vibes',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'song_vibes_cron')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

-- ===========================================================================
-- 3. Daily check-in (#9)
-- ===========================================================================

-- One per person per day, by their own clock. user_id points at
-- auth.users (as 0047 explains) so it adds no new path from songs or
-- reviews to profiles.
create table if not exists public.mood_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  status     text not null check (status in ('done', 'skipped')),
  answers    jsonb,
  shown      uuid[] not null default '{}',
  passed     uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

alter table public.mood_checkins enable row level security;

drop policy if exists "Users read their own check-ins" on public.mood_checkins;
create policy "Users read their own check-ins"
  on public.mood_checkins for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- Written only through the functions below.

-- A "day" the app sends must be today somewhere on Earth.
create or replace function public.checkin_day_ok(d date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select d between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1;
$$;

-- "Not today" or "Skip for today".
create or replace function public.skip_checkin(local_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.checkin_day_ok(local_day) then
    raise exception 'Not allowed.' using errcode = 'check_violation';
  end if;
  insert into public.mood_checkins (user_id, local_date, status)
  values (auth.uid(), local_day, 'skipped')
  on conflict (user_id, local_date) do nothing;
end;
$$;

revoke all on function public.skip_checkin(date) from public;
revoke execute on function public.skip_checkin(date) from anon;
grant execute on function public.skip_checkin(date) to authenticated;

-- The pick, in one place.
--
-- Answers: feeling (happy|sad|calm|stressed|energetic|nostalgic), goal
-- (match|lift|calm|focus), beat (slow|between|upbeat), familiar
-- (known|surprise). another = "Not feeling it? Show another": the song
-- shown last is passed on for today.
--
-- Wanted lyrics mood (the plan's table):
--   match: happy→happy, sad→sad, calm→none,romantic, stressed→angry,
--          energetic→happy,angry, nostalgic→nostalgic
--   lift:  anything→happy
--   calm:  nostalgic→nostalgic,none; anything else→none,romantic
--   focus: none
-- Beat: slow→low, between→mid, upbeat→high.
--
-- Relaxing when nothing fits, in order:
--   1. the wanted mood and beat
--   2. the wanted mood, the next energy over (mid ↔ low/high)
--   3. the wanted mood, any energy
--   4. neighbouring moods, any energy (sad↔nostalgic, happy↔romantic,
--      angry→sad, none→romantic); for focus instead: any mood, low energy
--   5. nothing: the app says it couldn't find a good match today
--
-- Only labels with confidence ≥ 0.6; never a song you rated, or one shown
-- or passed on today.
--
-- Ranking: +3 an artist you follow, +2 an artist of a song you liked or
-- rated 4+, +1.5 the artist's genre group is one of your music tags, up to
-- +2 when people with similar taste rate it highly, and a small random
-- nudge. "Something you know" doubles the first two. "Surprise me" gives +3
-- to artists you've never rated in your genre groups and -2 to ones you
-- follow or liked. Similar taste: people you can see and haven't muted who
-- rated at least 2 of the songs you rated, within one star every time.
create or replace function public.pick_checkin_song(local_day date, answers jsonb, another boolean default false)
returns table (
  song_id       uuid,
  title         text,
  artist_id     uuid,
  artist_name   text,
  cover_url     text,
  lyrics_mood   text,
  energy        text,
  relaxed       int,
  followed      boolean,
  liked_artist  boolean,
  genre_match   boolean,
  new_to_you    boolean,
  similar_avg   numeric,
  similar_count int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me        uuid := auth.uid();
  feeling   text := answers ->> 'feeling';
  goal      text := answers ->> 'goal';
  beat      text := answers ->> 'beat';
  familiar  text := answers ->> 'familiar';
  moods     text[];
  near      text[];
  want      text;
  adjacent  text[];
  row_id    uuid;
  shown_ids uuid[];
  passed_ids uuid[];
  pick      record;
begin
  if me is null or not public.checkin_day_ok(local_day) then
    raise exception 'Not allowed.' using errcode = 'check_violation';
  end if;
  if feeling not in ('happy', 'sad', 'calm', 'stressed', 'energetic', 'nostalgic')
     or goal not in ('match', 'lift', 'calm', 'focus')
     or beat not in ('slow', 'between', 'upbeat')
     or familiar not in ('known', 'surprise') then
    raise exception 'Unknown answer.' using errcode = 'check_violation';
  end if;

  moods := case
    when goal = 'focus' then array['none']
    when goal = 'lift' then array['happy']
    when goal = 'calm' then case when feeling = 'nostalgic' then array['nostalgic', 'none'] else array['none', 'romantic'] end
    else case feeling
      when 'happy' then array['happy']
      when 'sad' then array['sad']
      when 'calm' then array['none', 'romantic']
      when 'stressed' then array['angry']
      when 'energetic' then array['happy', 'angry']
      else array['nostalgic']
    end
  end;
  near := array(
    select distinct nb.mood
      from unnest(moods) as m(mood),
           lateral unnest(case m.mood
             when 'sad' then array['nostalgic']
             when 'nostalgic' then array['sad']
             when 'happy' then array['romantic']
             when 'romantic' then array['happy']
             when 'angry' then array['sad']
             else array['romantic'] end) as nb(mood)
     where nb.mood <> all (moods)
  );
  want := case beat when 'slow' then 'low' when 'between' then 'mid' else 'high' end;
  adjacent := case want when 'mid' then array['low', 'high'] else array['mid'] end;

  -- Today's row: created on the first pick, answers kept up to date.
  insert into public.mood_checkins (user_id, local_date, status, answers)
  values (me, local_day, 'done', answers)
  on conflict (user_id, local_date)
  do update set status = 'done', answers = excluded.answers, updated_at = now()
  returning id, shown, passed into row_id, shown_ids, passed_ids;

  -- "Show another" passes on the song shown last.
  if another and cardinality(shown_ids) > 0 then
    passed_ids := array_append(passed_ids, shown_ids[cardinality(shown_ids)]);
    update public.mood_checkins set passed = passed_ids where id = row_id;
  end if;

  with mine as (
    select
      coalesce((select array_agg(f.artist_id) from public.follows f where f.user_id = me), '{}') as followed,
      coalesce((
        select array_agg(distinct s.artist_id)
          from public.songs s
         where s.artist_id is not null
           and (s.id in (select l.song_id from public.song_likes l where l.user_id = me)
                or s.id in (select r.song_id from public.reviews r where r.user_id = me and r.rating >= 4))
      ), '{}') as liked,
      coalesce((
        select array_agg(distinct s.artist_id)
          from public.reviews r join public.songs s on s.id = r.song_id
         where r.user_id = me and s.artist_id is not null
      ), '{}') as rated_artists,
      public.tag_buckets((select p.favorite_genres from public.profiles p where p.id = me)) as buckets
  ),
  alike as (
    select o.user_id as who
      from public.reviews mr
      join public.reviews o on o.song_id = mr.song_id and o.user_id <> me
     where mr.user_id = me
       and public.can_view_profile(me, o.user_id)
       and not exists (select 1 from public.user_mutes um where um.muter_id = me and um.muted_id = o.user_id)
     group by o.user_id
    having count(*) >= 2 and bool_and(abs(o.rating - mr.rating) <= 1)
  ),
  pool as (
    select v.song_id as sid, v.lyrics_mood as mood, v.energy as nrg,
           case
             when v.lyrics_mood = any (moods) and v.energy = want then 0
             when v.lyrics_mood = any (moods) and v.energy = any (adjacent) then 1
             when v.lyrics_mood = any (moods) then 2
             when goal = 'focus' and v.energy = 'low' then 3
             when goal <> 'focus' and v.lyrics_mood = any (near) then 3
           end as step
      from public.song_vibes v
     where v.confidence >= 0.6
       and v.song_id <> all (shown_ids)
       and v.song_id <> all (passed_ids)
       and not exists (select 1 from public.reviews r where r.user_id = me and r.song_id = v.song_id)
  ),
  best_step as (select min(p.step) as t from pool p where p.step is not null),
  scored as (
    select p.sid, p.mood, p.nrg, p.step, s.title as ttl, s.artist_id as aid, a.name as aname, al.cover_url as cover,
           (s.artist_id = any (m.followed)) as is_followed,
           (s.artist_id = any (m.liked)) as is_liked,
           coalesce(public.artist_genre_buckets(a.genres_raw) && m.buckets, false) as is_genre,
           not (s.artist_id = any (m.followed) or s.artist_id = any (m.liked) or s.artist_id = any (m.rated_artists)) as is_new,
           (select avg(r.rating)::numeric from public.reviews r join alike sm on sm.who = r.user_id where r.song_id = p.sid) as sim_avg,
           (select count(*)::int from public.reviews r join alike sm on sm.who = r.user_id where r.song_id = p.sid) as sim_count
      from pool p
      join best_step b on p.step = b.t
      join public.songs s on s.id = p.sid
      left join public.artists a on a.id = s.artist_id
      left join public.albums al on al.id = s.album_id
      cross join mine m
  )
  select sc.* into pick
    from scored sc
   order by
     (case when familiar = 'known' then 6 else 3 end) * sc.is_followed::int
     + (case when familiar = 'known' then 4 else 2 end) * sc.is_liked::int
     + 1.5 * sc.is_genre::int
     + least(2, greatest(0, coalesce(sc.sim_avg, 3) - 3))
     + case when familiar = 'surprise' then
         3 * (sc.is_new and sc.is_genre)::int
         - 2 * (sc.is_followed or sc.is_liked)::int
       else 0 end
     + random() * 0.5
     desc
   limit 1;

  if not found then
    -- Nothing fits, even relaxed: the app says so honestly.
    return;
  end if;

  -- Remember it, so it isn't shown again today.
  update public.mood_checkins c set shown = array_append(c.shown, pick.sid) where c.id = row_id;

  song_id := pick.sid;
  title := pick.ttl;
  artist_id := pick.aid;
  artist_name := pick.aname;
  cover_url := pick.cover;
  lyrics_mood := pick.mood;
  energy := pick.nrg;
  relaxed := pick.step;
  followed := pick.is_followed;
  liked_artist := pick.is_liked;
  genre_match := pick.is_genre;
  new_to_you := pick.is_new;
  similar_avg := round(pick.sim_avg, 1);
  similar_count := pick.sim_count;
  return next;
end;
$$;

revoke all on function public.pick_checkin_song(date, jsonb, boolean) from public;
revoke execute on function public.pick_checkin_song(date, jsonb, boolean) from anon;
grant execute on function public.pick_checkin_song(date, jsonb, boolean) to authenticated;

-- ===========================================================================
-- 4. Song of the week (#10)
-- ===========================================================================

-- One song for everyone per week, Monday to Sunday in Asia/Riyadh. The
-- week's start is the key, so a week can only ever get one song. If the
-- song itself is ever removed from the catalogue, its week goes with it
-- rather than blocking the removal (the current week is then chosen again
-- on the next visit).
create table if not exists public.weekly_songs (
  week_start   date primary key check (extract(isodow from week_start) = 1),
  song_id      uuid not null references public.songs(id) on delete cascade,
  reason       text not null check (reason in ('most_rated', 'trending')),
  rating_count int not null default 0,
  chosen_at    timestamptz not null default now()
);

alter table public.weekly_songs enable row level security;

drop policy if exists "Signed-in users read the weekly songs" on public.weekly_songs;
create policy "Signed-in users read the weekly songs"
  on public.weekly_songs for select
  to authenticated
  using (true);
-- Written only by current_weekly_song().

-- This week's song, choosing it first if nobody has opened the app this
-- week yet: the song with the most new ratings last week (at least 3),
-- never a past song of the week; ties go to the higher average, then the
-- newest rating. Otherwise the top of Trending, never a past one. Two
-- people arriving at once both get the same row (the key decides).
create or replace function public.current_weekly_song()
returns table (week_start date, song_id uuid, reason text, rating_count int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  this_week date := date_trunc('week', now() at time zone 'Asia/Riyadh')::date;
  last_week date := date_trunc('week', now() at time zone 'Asia/Riyadh')::date - 7;
  chosen    uuid;
  why       text;
  n         int := 0;
begin
  if not exists (select 1 from public.weekly_songs w where w.week_start = this_week) then
    select r.song_id, count(*)::int
      into chosen, n
      from public.reviews r
     where (r.created_at at time zone 'Asia/Riyadh')::date >= last_week
       and (r.created_at at time zone 'Asia/Riyadh')::date < this_week
       and r.song_id not in (select w.song_id from public.weekly_songs w)
     group by r.song_id
    having count(*) >= 3
     order by count(*) desc, avg(r.rating) desc, max(r.created_at) desc
     limit 1;

    if chosen is not null then
      why := 'most_rated';
    else
      select s.id into chosen
        from public.songs s
       where s.id not in (select w.song_id from public.weekly_songs w)
       order by s.popularity desc nulls last, s.cached_at desc
       limit 1;
      why := 'trending';
      n := 0;
    end if;

    if chosen is not null then
      insert into public.weekly_songs (week_start, song_id, reason, rating_count)
      values (this_week, chosen, why, n)
      on conflict do nothing;
    end if;
  end if;

  return query
    select w.week_start, w.song_id, w.reason, w.rating_count
      from public.weekly_songs w
     where w.week_start = this_week;
end;
$$;

revoke all on function public.current_weekly_song() from public;
revoke execute on function public.current_weekly_song() from anon;
grant execute on function public.current_weekly_song() to authenticated;

-- Everything the card and the page show, in one request. Names only of
-- people you are allowed to see and have not muted; the average and the
-- 5-to-1 counts are totals, as on the song page.
create or replace function public.weekly_song_page(target_week date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  wk     date;
  w      record;
  result jsonb;
begin
  if me is null then
    raise exception 'Not allowed.' using errcode = 'check_violation';
  end if;
  if target_week is null then
    select c.week_start into wk from public.current_weekly_song() c;
  else
    wk := target_week;
  end if;
  select * into w from public.weekly_songs x where x.week_start = wk;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'week_start', w.week_start,
    'week_end', w.week_start + 6,
    'reason', w.reason,
    'week_rating_count', w.rating_count,
    'song', (
      select jsonb_build_object(
        'id', s.id, 'title', s.title, 'artist_id', s.artist_id, 'artist_name', a.name,
        'cover_url', al.cover_url, 'album_id', s.album_id
      )
        from public.songs s
        left join public.artists a on a.id = s.artist_id
        left join public.albums al on al.id = s.album_id
       where s.id = w.song_id
    ),
    'my_rating', (select r.rating from public.reviews r where r.song_id = w.song_id and r.user_id = me),
    'average', (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.song_id = w.song_id),
    'ratings', (select count(*) from public.reviews r where r.song_id = w.song_id),
    'distribution', (
      select jsonb_object_agg(g.stars, coalesce(d.cnt, 0))
        from generate_series(1, 5) as g(stars)
        left join (
          select r.rating as rt, count(*) as cnt from public.reviews r where r.song_id = w.song_id group by r.rating
        ) d on d.rt = g.stars
    ),
    'followed_raters', (
      select coalesce(jsonb_agg(x.person), '[]'::jsonb)
        from (
          select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) as person
            from public.reviews r
            join public.user_follows uf on uf.following_id = r.user_id and uf.follower_id = me and uf.status = 'accepted'
            join public.profiles p on p.id = r.user_id
           where r.song_id = w.song_id
             and not exists (select 1 from public.user_mutes um where um.muter_id = me and um.muted_id = r.user_id)
           order by r.created_at desc
           limit 5
        ) x
    ),
    'followed_rater_count', (
      select count(*)
        from public.reviews r
        join public.user_follows uf on uf.following_id = r.user_id and uf.follower_id = me and uf.status = 'accepted'
       where r.song_id = w.song_id
         and not exists (select 1 from public.user_mutes um where um.muter_id = me and um.muted_id = r.user_id)
    ),
    'top_reviews', (
      select coalesce(jsonb_agg(x.review order by x.likes desc, x.rating desc, x.created_at desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', r.id, 'user_id', r.user_id, 'rating', r.rating, 'body', r.body, 'title', r.title,
                   'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url
                 ) as review,
                 (select count(*) from public.review_likes l where l.review_id = r.id) as likes,
                 r.rating, r.created_at
            from public.reviews r
            join public.profiles p on p.id = r.user_id
           where r.song_id = w.song_id
             and char_length(btrim(coalesce(r.body, ''))) > 0
             and r.user_id <> me
             and public.can_view_profile(me, r.user_id)
             and not exists (select 1 from public.user_mutes um where um.muter_id = me and um.muted_id = r.user_id)
           order by 2 desc, r.rating desc, r.created_at desc
           limit 3
        ) x
    ),
    'matches_taste', (
      select exists (select 1 from public.follows f where f.user_id = me and f.artist_id = s.artist_id)
          or exists (
               select 1 from public.songs s2
                where s2.artist_id = s.artist_id
                  and (s2.id in (select l.song_id from public.song_likes l where l.user_id = me)
                       or s2.id in (select r.song_id from public.reviews r where r.user_id = me and r.rating >= 4))
             )
          or coalesce(public.artist_genre_buckets(a.genres_raw)
               && public.tag_buckets((select p.favorite_genres from public.profiles p where p.id = me)), false)
        from public.songs s
        left join public.artists a on a.id = s.artist_id
       where s.id = w.song_id
    ),
    'past_weeks', (
      select coalesce(jsonb_agg(x.wk order by x.ws desc), '[]'::jsonb)
        from (
          select pw.week_start as ws,
                 jsonb_build_object(
                   'week_start', pw.week_start, 'week_end', pw.week_start + 6,
                   'song_id', s.id, 'title', s.title, 'artist_name', a.name, 'cover_url', al.cover_url,
                   'average', (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.song_id = s.id)
                 ) as wk
            from public.weekly_songs pw
            join public.songs s on s.id = pw.song_id
            left join public.artists a on a.id = s.artist_id
            left join public.albums al on al.id = s.album_id
           where pw.week_start < w.week_start
           order by pw.week_start desc
           limit 8
        ) x
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.weekly_song_page(date) from public;
revoke execute on function public.weekly_song_page(date) from anon;
grant execute on function public.weekly_song_page(date) to authenticated;

-- ===========================================================================
-- 5. How many songs the check-in can pick from (for the first-day report)
-- ===========================================================================

create or replace function public.song_vibe_coverage()
returns table (lyrics_mood text, energy text, songs int)
language sql
security definer
set search_path = ''
stable
as $$
  select v.lyrics_mood, v.energy, count(*)::int
    from public.song_vibes v
   where v.confidence >= 0.6
   group by rollup (v.lyrics_mood, v.energy)
   order by 1 nulls first, 2 nulls first;
$$;

revoke all on function public.song_vibe_coverage() from public;
revoke execute on function public.song_vibe_coverage() from anon;
revoke execute on function public.song_vibe_coverage() from authenticated;
