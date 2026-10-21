-- Song of the week: weeks run Sunday 00:00 to Saturday 23:59, Saudi time
-- (Asia/Riyadh), instead of Monday to Sunday.
--
-- Changeover: the current song (the week stored as Monday Oct 19) keeps
-- running until Saturday Oct 24 23:59 Saudi time; the first Sunday week
-- starts on Sunday Oct 25. Ratings and reviews are not touched, and past
-- winners stay excluded, so no song is skipped or picked twice.
--
--   weekly_songs   + week_end, the week's last day, stored per week (the
--                    old week keeps its Sunday end; the current one ends
--                    Saturday Oct 24). "Starts on a Monday" becomes
--                    "Sunday weeks from Oct 25".
--   new function   riyadh_week_bounds(p_at): the one definition of a week
--   replaced       current_weekly_song(), weekly_song_page() (same
--                  signatures and grants; the page also returns starts_at
--                  and ends_at)
--
-- Safe while the app is in use: weekly_songs has a handful of rows, and
-- its lock is held only for this short transaction (lock_timeout stops it
-- queueing behind anything slow). Rollback:
-- supabase/rollbacks/0049_sunday_weeks_rollback.sql

begin;

set local lock_timeout = '5s';

-- Written for this Saturday's changeover. Run any later, the old rules
-- would already have started a Monday week; stop rather than guess.
do $$
begin
  if (now() at time zone 'Asia/Riyadh') >= timestamp '2026-10-25 00:00' then
    raise exception 'Too late for this migration: the changeover was Saturday Oct 24 23:59 Saudi time.';
  end if;
  if exists (select 1 from public.weekly_songs where week_start > date '2026-10-19') then
    raise exception 'A week after Oct 19 already exists; review before changing the week rule.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Where each week ends
-- ---------------------------------------------------------------------------

alter table public.weekly_songs add column if not exists week_end date;

update public.weekly_songs
   set week_end = case
                    when week_start = date '2026-10-19' then date '2026-10-24'
                    else week_start + 6
                  end
 where week_end is null;

alter table public.weekly_songs alter column week_end set not null;

alter table public.weekly_songs drop constraint if exists weekly_songs_week_start_check;
alter table public.weekly_songs add constraint weekly_songs_week_check check (
  -- From Oct 25: Sunday to Saturday.
  (week_start >= date '2026-10-25'
     and extract(dow from week_start) = 0
     and week_end = week_start + 6)
  -- Before: the Monday weeks, ending on Sunday (Saturday Oct 24 for the
  -- changeover week).
  or (week_start < date '2026-10-25'
     and extract(isodow from week_start) = 1
     and week_end between week_start + 5 and week_start + 6)
);

-- ---------------------------------------------------------------------------
-- 2. What a week is
-- ---------------------------------------------------------------------------

-- The Sunday-to-Saturday week (Saudi time) a moment falls in: its first
-- and last day, and the exact moments it starts and ends (ends_at is the
-- next Sunday 00:00, the first moment not in the week).
create or replace function public.riyadh_week_bounds(p_at timestamptz default now())
returns table (week_start date, week_end date, starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select d.ws, d.ws + 6,
         d.ws::timestamp at time zone 'Asia/Riyadh',
         (d.ws + 7)::timestamp at time zone 'Asia/Riyadh'
    from (
      select (p_at at time zone 'Asia/Riyadh')::date
             - extract(dow from (p_at at time zone 'Asia/Riyadh'))::int as ws
    ) d;
$$;

revoke all on function public.riyadh_week_bounds(timestamptz) from public;
revoke execute on function public.riyadh_week_bounds(timestamptz) from anon;
grant execute on function public.riyadh_week_bounds(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. This week's song
-- ---------------------------------------------------------------------------

-- The week whose days include today (Saudi time), choosing it first if
-- nobody has opened the app this week yet: the song with the most new
-- ratings in the 7 days before the week started (at least 3), never a past
-- song of the week; ties go to the higher average, then the newest rating.
-- Otherwise the top of Trending, never a past one. Two people arriving at
-- once both get the same row (the key decides).
--
-- "Includes today", rather than "starts this Sunday", is what lets the
-- changeover week (Monday Oct 19 to Saturday Oct 24) run to its end.
create or replace function public.current_weekly_song()
returns table (week_start date, song_id uuid, reason text, rating_count int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  today  date := (now() at time zone 'Asia/Riyadh')::date;
  b      record;
  chosen uuid;
  why    text;
  n      int := 0;
begin
  if not exists (
    select 1 from public.weekly_songs w where today between w.week_start and w.week_end
  ) then
    select * into b from public.riyadh_week_bounds(now());

    select r.song_id, count(*)::int
      into chosen, n
      from public.reviews r
     where r.created_at >= b.starts_at - interval '7 days'
       and r.created_at < b.starts_at
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
      insert into public.weekly_songs (week_start, week_end, song_id, reason, rating_count)
      values (b.week_start, b.week_end, chosen, why, n)
      on conflict do nothing;
    end if;
  end if;

  return query
    select w.week_start, w.song_id, w.reason, w.rating_count
      from public.weekly_songs w
     where today between w.week_start and w.week_end
     order by w.week_start desc
     limit 1;
end;
$$;

-- Grants are unchanged (create or replace keeps them).

-- ---------------------------------------------------------------------------
-- 4. The card's and page's data: the stored week end, plus starts_at and
--    ends_at. Otherwise as in 0048.
-- ---------------------------------------------------------------------------

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
    'week_end', w.week_end,
    -- The exact moments the week starts and ends (00:00 on its first day
    -- and 00:00 after its last, Saudi time), so the app's countdown is the
    -- database's.
    'starts_at', (w.week_start::timestamp at time zone 'Asia/Riyadh'),
    'ends_at', ((w.week_end + 1)::timestamp at time zone 'Asia/Riyadh'),
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
                   'week_start', pw.week_start, 'week_end', pw.week_end,
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

commit;
