-- New-user setup, music tags, the Beatie tour, and suggestions for setup.
--
-- 1. profiles gains five nullable columns:
--      setup_completed_at         when /welcome was finished (null: not yet)
--      setup_step                 the step they were on (1–7, 8 = "All set"),
--                                 so leaving halfway resumes there
--      tutorial_completed_at      finished the tour
--      tutorial_skipped_at        skipped the tour
--      welcome_card_dismissed_at  closed the one-time "Your music tags are
--                                 back" card on Home (existing users)
--
-- 2. UPDATES EXISTING ROWS: every account that exists when this runs gets
--    setup_completed_at = now(), so no current user is ever sent to
--    /welcome. That is the only change to existing data.
--
-- 3. Music tags reuse profiles.favorite_genres (the column the old genre
--    picker filled; 6 accounts still have tags). New rule, checked by a
--    trigger only when the tags are set or changed: at most 8 tags, each
--    1–24 characters, trimmed, no repeats (ignoring case). Existing tags
--    already fit (the most anyone has is 5) and aren't rewritten.
--
-- 4. follows (artist follows, which already exist) gains created_at: null
--    for follows made before this, the time for new ones.
--
-- 5. Functions for the setup screens, returning only public information:
--      tag_buckets(tags)                  your tags as genre groups
--      suggested_reviewers_for_tags(tags) public reviewers who share them
--      suggested_artists(tags)            artists in those genre groups
--      suggested_songs(artist_ids, tags)  songs by those artists, or in
--                                         those genre groups
--
-- Adds columns, a trigger and functions. Undo with
-- supabase/rollbacks/0039_onboarding_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Setup and tour state
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists setup_completed_at timestamptz;
alter table public.profiles add column if not exists setup_step smallint
  check (setup_step between 1 and 8);
alter table public.profiles add column if not exists tutorial_completed_at timestamptz;
alter table public.profiles add column if not exists tutorial_skipped_at timestamptz;
alter table public.profiles add column if not exists welcome_card_dismissed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Existing accounts skip setup (updates existing rows)
-- ---------------------------------------------------------------------------

update public.profiles
   set setup_completed_at = now()
 where setup_completed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Music tags: at most 8, each 1–24 characters, no repeats
-- ---------------------------------------------------------------------------

create or replace function public.check_music_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.favorite_genres is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.favorite_genres is not distinct from old.favorite_genres then
    return new;
  end if;

  -- Trim, drop blanks and repeats. Repeats are compared ignoring capitals
  -- and spaces at the ends, so "R&B" and "r&b" are one tag; the first
  -- spelling and the order are kept.
  new.favorite_genres := coalesce((
    select array_agg(t.tag order by t.pos)
      from (
        select distinct on (lower(btrim(g))) btrim(g) as tag, pos
          from unnest(new.favorite_genres) with ordinality as u(g, pos)
         where btrim(g) <> ''
         order by lower(btrim(g)), pos
      ) t
  ), '{}');

  if cardinality(new.favorite_genres) > 8 then
    raise exception 'At most 8 music tags.' using errcode = '23514', hint = 'tags_too_many';
  end if;
  if exists (select 1 from unnest(new.favorite_genres) g where char_length(g) > 24) then
    raise exception 'Music tags are at most 24 characters.' using errcode = '23514', hint = 'tag_too_long';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_music_tags on public.profiles;
create trigger profiles_music_tags
  before insert or update of favorite_genres on public.profiles
  for each row execute function public.check_music_tags();

-- ---------------------------------------------------------------------------
-- 4. When an artist was followed
-- ---------------------------------------------------------------------------

alter table public.follows add column if not exists created_at timestamptz;
alter table public.follows alter column created_at set default now();

-- ---------------------------------------------------------------------------
-- 5. Suggestions for setup
-- ---------------------------------------------------------------------------

-- Tags as genre groups (0031's buckets), Other left out: "Lo-fi" is Indie &
-- Alternative, "Soul" is R&B & Soul, a custom tag nobody maps is nothing.
create or replace function public.tag_buckets(p_tags text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct b), '{}')
    from unnest(coalesce(p_tags, '{}')) as t
    cross join lateral public.genre_bucket_of(t) as b
   where b <> 'Other'
$$;

-- Public reviewers who like what you like. also_into lists your tags they
-- share: the same tag on their profile, or a genre group their reviewed
-- songs fall in. Leaves out you, private accounts and people you follow.
create or replace function public.suggested_reviewers_for_tags(p_tags text[], p_limit int default 5)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  review_count bigint,
  also_into    text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  mine as (
    select t as tag, public.genre_bucket_of(t) as bucket
      from unnest(coalesce(p_tags, '{}')) as t
  ),
  people as (
    select p.id, p.username, p.display_name, p.avatar_url, p.favorite_genres,
           count(r.id) as review_count,
           coalesce(array_agg(distinct bk) filter (where bk is not null), '{}') as buckets
      from public.profiles p
      join public.reviews r on r.user_id = p.id
      join public.songs s on s.id = r.song_id
      left join public.artists a on a.id = s.artist_id
      left join lateral unnest(public.artist_genre_buckets(a.genres_raw)) as bk on true
      cross join me
     where not coalesce(p.is_private, false)
       and p.id <> me.id
       and not exists (
         select 1 from public.user_follows uf
          where uf.follower_id = me.id and uf.following_id = p.id
       )
     group by p.id, p.username, p.display_name, p.avatar_url, p.favorite_genres
  ),
  scored as (
    select pe.*,
           coalesce((
             select array_agg(m.tag order by m.tag)
               from mine m
              where exists (select 1 from unnest(coalesce(pe.favorite_genres, '{}')) f where lower(f) = lower(m.tag))
                 or (m.bucket <> 'Other' and m.bucket = any (pe.buckets))
           ), '{}') as shared
      from people pe
  )
  select sc.id, sc.username, sc.display_name, sc.avatar_url, sc.review_count, sc.shared
    from scored sc
   order by cardinality(sc.shared) desc, sc.review_count desc, sc.username
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

-- Artists (with at least one song) in the genre groups your tags point to,
-- the most rated and most popular first; topped up with popular artists
-- when too few match.
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

-- Songs to like: by the artists just followed (taking turns between them),
-- or, with none followed, in the genre groups your tags point to. Only
-- songs already in the catalog; leaves out songs you already like and the
-- same title twice by one artist.
create or replace function public.suggested_songs(p_artist_ids uuid[], p_tags text[], p_limit int default 5)
returns table (
  id          uuid,
  title       text,
  artist_id   uuid,
  artist_name text,
  album_id    uuid,
  cover_url   text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with wanted as (select public.tag_buckets(p_tags) as buckets),
  pool as (
    select s.id, s.title, s.artist_id, a.name as artist_name, s.album_id, al.cover_url,
           s.popularity
      from public.songs s
      join public.artists a on a.id = s.artist_id
      left join public.albums al on al.id = s.album_id
      cross join wanted w
     where (
             (cardinality(coalesce(p_artist_ids, '{}')) > 0 and s.artist_id = any (p_artist_ids))
          or (cardinality(coalesce(p_artist_ids, '{}')) = 0 and public.artist_genre_buckets(a.genres_raw) && w.buckets)
           )
       and not exists (
         select 1 from public.song_likes sl where sl.user_id = (select auth.uid()) and sl.song_id = s.id
       )
  ),
  distinct_titles as (
    select distinct on (p.artist_id, lower(btrim(p.title))) p.*
      from pool p
     order by p.artist_id, lower(btrim(p.title)), p.popularity desc nulls last, p.id
  ),
  ranked as (
    select d.*, row_number() over (partition by d.artist_id order by d.popularity desc nulls last, d.id) as turn
      from distinct_titles d
  )
  select r.id, r.title, r.artist_id, r.artist_name, r.album_id, r.cover_url
    from ranked r
   order by r.turn, r.popularity desc nulls last, r.id
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

revoke all on function public.suggested_reviewers_for_tags(text[], int) from public, anon;
revoke all on function public.suggested_artists(text[], int) from public, anon;
revoke all on function public.suggested_songs(uuid[], text[], int) from public, anon;
grant execute on function public.tag_buckets(text[]) to authenticated;
grant execute on function public.suggested_reviewers_for_tags(text[], int) to authenticated;
grant execute on function public.suggested_artists(text[], int) to authenticated;
grant execute on function public.suggested_songs(uuid[], text[], int) to authenticated;

commit;
