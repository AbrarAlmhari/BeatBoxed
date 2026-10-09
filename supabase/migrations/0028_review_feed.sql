-- The review feed on Home: For You and Following, plus review reports.
--
-- Privacy is not reimplemented here. Every feed function is SECURITY
-- INVOKER, so the reviews select policy -- can_view_profile(), and through
-- it viewer_follows() from 0027 -- filters every row exactly as it does
-- anywhere else; each function also calls can_view_profile() explicitly as
-- a second check. A private user's review can't appear for someone who isn't
-- an accepted follower, whichever way the feed is queried.
--
-- The minimum length (body only, trimmed) is a parameter, not a constant
-- here, so the app's FEED_MIN_CHARS stays the one place it's set. Shorter
-- and star-only reviews still count in song averages and still show on
-- song pages; the feed simply doesn't list them.
--
-- All or nothing. Undo with supabase/rollbacks/0028_review_feed_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Indexes the feed leans on
-- ---------------------------------------------------------------------------

-- Following pages newest-first with a (created_at, id) cursor.
create index if not exists reviews_created_at_id_idx
  on public.reviews (created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 2. Following: accepted follows plus your own reviews, newest first
-- ---------------------------------------------------------------------------

-- Cursor is (created_at, id) of the last row of the previous page; both
-- null for the first page. id breaks ties, so two reviews written in the
-- same instant can't be skipped or repeated across a page boundary.
create or replace function public.feed_following(
  min_chars  int,
  before_at  timestamptz default null,
  before_id  uuid default null,
  page_size  int default 20
)
returns table (review_id uuid, created_at timestamptz)
language sql
security invoker
set search_path = ''
stable
as $$
  select r.id, r.created_at
    from public.reviews r
   where (r.user_id = (select auth.uid()) or public.viewer_follows(r.user_id))
     and public.can_view_profile((select auth.uid()), r.user_id)
     and char_length(btrim(coalesce(r.body, ''))) >= min_chars
     and (
       before_at is null
       or r.created_at < before_at
       or (r.created_at = before_at and r.id < before_id)
     )
   order by r.created_at desc, r.id desc
   limit least(greatest(page_size, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- 3. For You: ranked by recency, engagement and relevance to the viewer
--
--   engagement = ln(1 + likes + 2 * comments)
--   relevance  = 1.5  follows the song's artist
--              + 1.0  liked the song
--              + 1.0  reviewed the song too
--              + 0.5  the song's genre is one of their favourite genres
--              + 0.5  follows the author
--   score      = (1 + engagement + relevance) / (hours_old + 2) ^ 1.3
--
-- With no relevance signal it degrades to recent-and-popular, so it is only
-- empty when nobody else has written a feed-length review at all.
--
-- as_of is fixed by the client when the first page loads, so ages -- and so
-- scores -- don't drift between pages; the cursor is (score, id) of the last
-- row shown. Reviews newer than as_of wait for the next refresh rather than
-- shuffling a list someone is scrolling. Likes landing mid-scroll can still
-- move a score; the client drops any id it has already shown.
-- ---------------------------------------------------------------------------

create or replace function public.feed_for_you(
  min_chars   int,
  as_of       timestamptz,
  after_score double precision default null,
  after_id    uuid default null,
  page_size   int default 20
)
returns table (review_id uuid, created_at timestamptz, score double precision)
language sql
security invoker
set search_path = ''
stable
as $$
  with me as (
    select
      (select auth.uid()) as id,
      coalesce(
        (select p.favorite_genres from public.profiles p where p.id = (select auth.uid())),
        '{}'::text[]
      ) as genres
  ),
  candidates as (
    select
      r.id,
      r.created_at,
      (
        1
        + ln(
            1
            + (select count(*) from public.review_likes l where l.review_id = r.id)
            + 2 * (select count(*) from public.review_comments c where c.review_id = r.id)
          )
        + 1.5 * (exists (
            select 1 from public.follows f
             where f.user_id = me.id and f.artist_id = s.artist_id
          ))::int
        + 1.0 * (exists (
            select 1 from public.song_likes sl
             where sl.user_id = me.id and sl.song_id = r.song_id
          ))::int
        + 1.0 * (exists (
            select 1 from public.reviews mine
             where mine.user_id = me.id and mine.song_id = r.song_id
          ))::int
        + 0.5 * (s.genre is not null and s.genre = any (me.genres))::int
        + 0.5 * (public.viewer_follows(r.user_id))::int
      )
      / power(
          greatest(extract(epoch from (as_of - r.created_at)) / 3600.0, 0) + 2,
          1.3
        ) as score
      from public.reviews r
      join public.songs s on s.id = r.song_id
      cross join me
     where r.user_id <> me.id
       and public.can_view_profile(me.id, r.user_id)
       and char_length(btrim(coalesce(r.body, ''))) >= min_chars
       and r.created_at <= as_of
  )
  select c.id, c.created_at, c.score::double precision
    from candidates c
   where after_score is null
      or c.score < after_score
      or (c.score = after_score and c.id < after_id)
   order by c.score desc, c.id desc
   limit least(greatest(page_size, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- 4. Suggestions for an empty Following tab
--
-- Public accounts that write feed-length reviews most often, leaving out the
-- viewer and anyone they already follow or have asked to follow. Invoker
-- rights again: only public authors qualify, and their reviews are visible
-- to everyone anyway.
-- ---------------------------------------------------------------------------

create or replace function public.suggested_reviewers(
  min_chars int,
  max_count int default 5
)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  review_count bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
  select p.id, p.username, p.display_name, p.avatar_url, count(r.id) as review_count
    from public.profiles p
    join public.reviews r on r.user_id = p.id
   where not coalesce(p.is_private, false)
     and p.id <> (select auth.uid())
     and char_length(btrim(coalesce(r.body, ''))) >= min_chars
     and not exists (
       select 1 from public.user_follows uf
        where uf.follower_id = (select auth.uid()) and uf.following_id = p.id
     )
   group by p.id, p.username, p.display_name, p.avatar_url
   order by count(r.id) desc, max(r.created_at) desc
   limit least(greatest(max_count, 1), 20);
$$;

revoke all on function public.feed_following(int, timestamptz, uuid, int) from public;
revoke execute on function public.feed_following(int, timestamptz, uuid, int) from anon;
grant execute on function public.feed_following(int, timestamptz, uuid, int) to authenticated;

revoke all on function public.feed_for_you(int, timestamptz, double precision, uuid, int) from public;
revoke execute on function public.feed_for_you(int, timestamptz, double precision, uuid, int) from anon;
grant execute on function public.feed_for_you(int, timestamptz, double precision, uuid, int) to authenticated;

revoke all on function public.suggested_reviewers(int, int) from public;
revoke execute on function public.suggested_reviewers(int, int) from anon;
grant execute on function public.suggested_reviewers(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Review reports
--
-- Deliberately simple: who reported what, why, and when. There is no
-- moderation screen; the team reads this table in the dashboard.
-- ---------------------------------------------------------------------------

create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  review_id   uuid not null references public.reviews(id)  on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  -- Reporting the same review twice adds nothing.
  constraint review_reports_once unique (reporter_id, review_id)
);

create index if not exists review_reports_review_idx
  on public.review_reports (review_id);

alter table public.review_reports enable row level security;

-- Report only as yourself, only a review you can actually see (the subquery
-- runs under the reviews select policy), and never your own.
drop policy if exists "Users report reviews they can see" on public.review_reports;
create policy "Users report reviews they can see"
  on public.review_reports for insert to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and exists (
      select 1 from public.reviews r
       where r.id = review_id
         and r.user_id <> (select auth.uid())
    )
  );

-- You can see your own reports (so the app knows you already reported);
-- nobody else's. No update or delete policy: a report is a record.
drop policy if exists "Users read their own reports" on public.review_reports;
create policy "Users read their own reports"
  on public.review_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);

revoke all on table public.review_reports from anon;

commit;
