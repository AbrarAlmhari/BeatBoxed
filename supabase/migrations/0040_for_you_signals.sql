-- For You uses the signals setup collects (music tags, followed artists,
-- liked songs), added on top of the existing ranking, not a rewrite.
--
-- Already in the score before this (unchanged):
--   +1.5  you follow the song's artist
--   +1.0  you liked this song
--   +1.0  you reviewed this song too
--   +0.5  the song's genre is one of your tags (song genres are almost
--         always empty, so this rarely fires; kept as it was)
--   +0.5  you follow the author
--   +length (0038)
-- New:
--   +0.75 the song's artist is in a genre group one of your music tags
--         points to (tag_buckets() and artist_genre_buckets())
--   +0.5  you liked a different song by the same artist
--
-- The score is still divided by age, so recent reviews still lead; these
-- only lift what matches your taste. Paging, privacy and the 20-character
-- rule are unchanged.
--
-- Same signature, so it replaces 0038's function in place. Needs 0039
-- (tag_buckets). Undo with supabase/rollbacks/0040_for_you_signals_rollback.sql.
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
      ) as genres,
      public.tag_buckets(
        (select p.favorite_genres from public.profiles p where p.id = (select auth.uid()))
      ) as tag_buckets
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
