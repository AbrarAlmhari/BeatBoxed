-- Song of the week: copies of the same song count as one song.
--
-- The same recording can be saved more than once (single, album, deluxe,
-- remaster), each with its own id. The weekly song treated those copies as
-- different songs, so one song won three weeks in a row (Nov 1, 8 and 15,
-- three copies of the same track). Now:
--
--   * a song can't win if a copy of it has already won a week;
--   * when a song is chosen, the copy with the most reviews is used;
--   * the page's list of past weeks shows each song once (the first week
--     it won); the later weeks are kept, only hidden from that list.
--
-- Two songs are copies when they have the same main artist, the same title
-- once cleaned up (see song_title_key) and lengths within 10 seconds of
-- each other (or a length is missing).
--
-- Nothing is deleted or merged: no song, review, like, playlist entry,
-- artist or past week is changed. Only functions are added or replaced.
--
--   new        song_title_key(title), same_recording(...),
--              weekly_song_choice(starts_at, past) (the choice itself, with
--              no writing, so it can be tested without touching the weeks)
--   replaced   current_weekly_song() and weekly_song_page() (same
--              signatures and grants)
--
-- Rollback: supabase/rollbacks/0062_weekly_song_copies_rollback.sql

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. What counts as the same song
-- ---------------------------------------------------------------------------

-- A title with the packaging taken off: lowercase, without parts like
-- "- Remastered 2011", "(Deluxe)", "- Single Version", "(feat. X)",
-- "(with X)" or "(From "Film")", and without punctuation. A part that says live, acoustic, remix, mix,
-- karaoke, instrumental, demo, edit, slowed, sped up, cover or session is
-- kept, because that is a different performance.
create or replace function public.song_title_key(p_title text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t      text := lower(coalesce(p_title, ''));
  part   text;
  strip  constant text := '(remaster|deluxe|single version|album version|original version|lp version|mono|stereo|bonus track|anniversary|expanded|explicit|clean version|feat\.|ft\.|featuring|from\s+["“]|from the (series|film|movie|motion picture|original)|^[(\[]with\s)';
  keep   constant text := '(live|acoustic|remix|\mmix\M|karaoke|instrumental|demo|\medit\M|slowed|sped|cover|session)';
  tail   text;
begin
  -- Parts in brackets: (Deluxe), [Remastered 2011], (feat. Ray Dalton)
  for part in select m[1] from regexp_matches(t, '([(\[][^)\]]*[)\]])', 'g') as m loop
    if part ~ strip and part !~ keep then
      t := replace(t, part, ' ');
    end if;
  end loop;

  -- Parts after a dash at the end: "- Remastered 2011", "- Single Version"
  loop
    tail := substring(t from '\s-\s([^-]*)$');
    exit when tail is null or tail !~ strip or tail ~ keep;
    t := regexp_replace(t, '\s-\s[^-]*$', '');
  end loop;

  t := regexp_replace(t, '[^[:alnum:][:space:]]', '', 'g');
  return btrim(regexp_replace(t, '\s+', ' ', 'g'));
end;
$$;

-- Two songs are copies of one recording: same main artist, same cleaned-up
-- title, lengths within 10 seconds (or a length unknown).
create or replace function public.same_recording(
  a_artist uuid, a_title text, a_ms int,
  b_artist uuid, b_title text, b_ms int
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a_artist = b_artist
     and public.song_title_key(a_title) = public.song_title_key(b_title)
     and (a_ms is null or b_ms is null or abs(a_ms - b_ms) <= 10000);
$$;

-- Only the database itself (and the tests, as the service role) call them.
-- New functions in public are open to everyone by default, so close them.
revoke all on function public.song_title_key(text) from public;
revoke all on function public.same_recording(uuid, text, int, uuid, text, int) from public;
revoke execute on function public.song_title_key(text) from anon, authenticated;
revoke execute on function public.same_recording(uuid, text, int, uuid, text, int) from anon, authenticated;
grant execute on function public.song_title_key(text) to service_role;
grant execute on function public.same_recording(uuid, text, int, uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The choice, without writing anything
-- ---------------------------------------------------------------------------

-- The song for a week starting at p_starts_at, given the songs that already
-- won (p_past). Same rules as before (most new ratings in the 7 days before
-- the week, at least 3; ties to the higher average, then the newest rating;
-- otherwise the top of Trending), except that a copy of a past winner can't
-- be chosen, and the copy with the most reviews is the one returned.
-- Writes nothing: current_weekly_song() stores the result.
create or replace function public.weekly_song_choice(p_starts_at timestamptz, p_past uuid[])
returns table (song_id uuid, reason text, rating_count int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  chosen uuid;
  why    text;
  n      int := 0;
begin
  select r.song_id, count(*)::int
    into chosen, n
    from public.reviews r
    join public.songs s on s.id = r.song_id
   where r.created_at >= p_starts_at - interval '7 days'
     and r.created_at < p_starts_at
     and not exists (
           select 1 from public.songs ps
            where ps.id = any(coalesce(p_past, '{}'))
              and public.same_recording(ps.artist_id, ps.title, ps.duration_ms, s.artist_id, s.title, s.duration_ms)
         )
   group by r.song_id
  having count(*) >= 3
   order by count(*) desc, avg(r.rating) desc, max(r.created_at) desc
   limit 1;

  if chosen is not null then
    why := 'most_rated';
  else
    select s.id into chosen
      from public.songs s
     where not exists (
             select 1 from public.songs ps
              where ps.id = any(coalesce(p_past, '{}'))
                and public.same_recording(ps.artist_id, ps.title, ps.duration_ms, s.artist_id, s.title, s.duration_ms)
           )
     order by s.popularity desc nulls last, s.cached_at desc
     limit 1;
    why := 'trending';
    n := 0;
  end if;

  if chosen is null then
    return;
  end if;

  -- Of the chosen song's copies, the one with the most reviews (the chosen
  -- copy itself on a tie).
  select c.id into chosen
    from public.songs s
    join public.songs c
      on c.artist_id = s.artist_id
     and public.same_recording(s.artist_id, s.title, s.duration_ms, c.artist_id, c.title, c.duration_ms)
   where s.id = chosen
   order by (select count(*) from public.reviews r where r.song_id = c.id) desc, (c.id = chosen) desc, c.id
   limit 1;

  return query select chosen, why, n;
end;
$$;

-- Only the database itself (and the tests, as the service role) call it.
revoke all on function public.weekly_song_choice(timestamptz, uuid[]) from public;
revoke execute on function public.weekly_song_choice(timestamptz, uuid[]) from anon, authenticated;
grant execute on function public.weekly_song_choice(timestamptz, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. This week's song (as in 0049, with the choice above)
-- ---------------------------------------------------------------------------

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
  c      record;
begin
  if not exists (
    select 1 from public.weekly_songs w where today between w.week_start and w.week_end
  ) then
    select * into b from public.riyadh_week_bounds(now());

    select * into c
      from public.weekly_song_choice(b.starts_at, array(select w.song_id from public.weekly_songs w));

    if c.song_id is not null then
      insert into public.weekly_songs (week_start, week_end, song_id, reason, rating_count)
      values (b.week_start, b.week_end, c.song_id, c.reason, c.rating_count)
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
-- 4. The card's and page's data: as in 0049, except that past weeks skip a
--    week whose song is a copy of an earlier week's song.
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
             -- A copy of an earlier week's song: shown once, at its first week.
             and not exists (
                   select 1
                     from public.weekly_songs ew
                     join public.songs es on es.id = ew.song_id
                    where ew.week_start < pw.week_start
                      and public.same_recording(es.artist_id, es.title, es.duration_ms, s.artist_id, s.title, s.duration_ms)
                 )
           order by pw.week_start desc
           limit 8
        ) x
    )
  ) into result;
  return result;
end;
$$;

-- Grants are unchanged (create or replace keeps them).

commit;
