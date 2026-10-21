-- Undoes migrations/0049_sunday_weeks.sql: weeks go back to Monday to
-- Sunday (Saudi time). Run by hand only, together with reverting the app,
-- which reads ends_at from weekly_song_page.
--
-- Kept: every song of the week chosen so far, including any Sunday weeks.
-- The Monday rule comes back NOT VALID so those rows can stay. Note that
-- the old function then looks for a Monday week and, finding none, picks
-- one, so a Sunday week's song would be replaced from the next Monday.
-- Ratings and reviews are not touched.
begin;

set local lock_timeout = '5s';

-- The 0048 versions, as they were.

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

drop function if exists public.riyadh_week_bounds(timestamptz);

alter table public.weekly_songs drop constraint if exists weekly_songs_week_check;
alter table public.weekly_songs
  add constraint weekly_songs_week_start_check check (extract(isodow from week_start) = 1) not valid;
alter table public.weekly_songs drop column if exists week_end;

commit;
