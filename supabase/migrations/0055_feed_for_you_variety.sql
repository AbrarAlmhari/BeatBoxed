-- For You with variety (0055). The same match as feed_for_you (0046), then:
--
--   * a gentler fade: (hours + 12) ^ 0.8 instead of (hours + 2) ^ 1.3, so
--     older reviews sink slowly and never drop out;
--   * a shuffle of up to 10% either way, fixed by the session's seed and the
--     review's id, so a refresh shows a different mix but one scrolling
--     session keeps its order;
--   * reviews this device has already scrolled past (seen_ids) count about
--     a third: they sink, they stay in the feed;
--   * each further review by the same author counts less (1, 0.45, 0.2,
--     ...), so one person's batch is spread out instead of filling a page.
--
-- Every score is fixed for a given as_of, seed and seen_ids, so paging by
-- "everything below the last score" never repeats or skips a review.
--
-- A new function beside feed_for_you, which is left as it is: the app
-- switches over once this one has been checked, and rolling back is just
-- dropping this one.
begin;

set local lock_timeout = '5s';

create or replace function public.feed_for_you_mixed(
  min_chars   int,
  as_of       timestamptz,
  seed        int,
  seen_ids    uuid[] default '{}',
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
      ) as genres,
      public.tag_buckets(
        (select p.favorite_genres from public.profiles p where p.id = (select auth.uid()))
      ) as tag_buckets
  ),
  candidates as (
    select
      r.id,
      r.user_id,
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
        -- Length: a gentle bonus that grows with the body and stops at 400
        -- characters (about +0.17 at 20, +0.48 at 80, +0.80 at 200, +1.10
        -- at 400 and beyond).
        + 0.5 * ln(1 + least(char_length(btrim(coalesce(r.body, ''))), 400) / 50.0)
        -- Music tags: the song's artist is in a genre group one of your tags
        -- points to ("Lo-fi" is Indie & Alternative, "Soul" is R&B & Soul).
        + 0.75 * (exists (
            select 1
              from public.artists a
             where a.id = s.artist_id
               and public.artist_genre_buckets(a.genres_raw) && me.tag_buckets
          ))::int
        -- Liked songs: you liked a different song by the same artist.
        + 0.5 * (exists (
            select 1
              from public.song_likes sl2
              join public.songs s2 on s2.id = sl2.song_id
             where sl2.user_id = me.id
               and s2.artist_id = s.artist_id
               and s2.id <> r.song_id
          ))::int
      ) as base
      from public.reviews r
      join public.songs s on s.id = r.song_id
      cross join me
     where r.user_id <> me.id
       and public.can_view_profile(me.id, r.user_id)
       -- Not from someone you muted (your own mutes are readable to you).
       and not exists (
         select 1 from public.user_mutes um
          where um.muter_id = me.id and um.muted_id = r.user_id
       )
       and char_length(btrim(coalesce(r.body, ''))) >= min_chars
       and r.created_at <= as_of
  ),
  timed as (
    select
      c.id,
      c.user_id,
      c.created_at,
      c.base
      -- Gentler fade: a week-old review needs about 3.6 times a day-old
      -- one's match to pass it (about 11 times with feed_for_you's fade).
      / power(
          greatest(extract(epoch from (as_of - c.created_at)) / 3600.0, 0) + 12,
          0.8
        )
      -- Up to 10% either way, the same for the whole session (seed).
      * (
          0.9
          + 0.2 * (
              (('x' || substr(md5(seed::text || c.id::text), 1, 8))::bit(32)::int::double precision
                + 2147483648)
              / 4294967296.0
            )
        )
      -- Already scrolled past on this device: sinks, stays in the feed.
      * case when c.id = any (coalesce(seen_ids, '{}'::uuid[])) then 0.35 else 1 end
        as s1
      from candidates c
  ),
  spread as (
    -- Each further review by the same author counts less: 1, 0.45, 0.2, ...
    select
      t.id,
      t.created_at,
      t.s1 * power(
        0.45,
        (row_number() over (partition by t.user_id order by t.s1 desc, t.id desc)) - 1
      ) as score
      from timed t
  )
  select sp.id, sp.created_at, sp.score::double precision
    from spread sp
   where after_score is null
      or sp.score < after_score
      or (sp.score = after_score and sp.id < after_id)
   order by sp.score desc, sp.id desc
   limit least(greatest(page_size, 1), 50);
$$;

revoke all on function public.feed_for_you_mixed(int, timestamptz, int, uuid[], double precision, uuid, int) from public;
revoke execute on function public.feed_for_you_mixed(int, timestamptz, int, uuid[], double precision, uuid, int) from anon;
grant execute on function public.feed_for_you_mixed(int, timestamptz, int, uuid[], double precision, uuid, int) to authenticated;

commit;
