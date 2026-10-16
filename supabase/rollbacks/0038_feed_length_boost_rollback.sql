-- Undoes migrations/0038_feed_length_boost.sql: For You as 0028 defined it,
-- without the length bonus. Run by hand only. Lost: nothing.
begin;

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

revoke all on function public.feed_for_you(int, timestamptz, double precision, uuid, int) from public;
revoke execute on function public.feed_for_you(int, timestamptz, double precision, uuid, int) from anon;
grant execute on function public.feed_for_you(int, timestamptz, double precision, uuid, int) to authenticated;

commit;
