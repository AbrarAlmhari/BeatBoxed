-- Muting someone.
--
-- Additive: a new table and its policies, a new internal function, and
-- replaced functions that now leave out people you muted. No existing row
-- is changed.
--
-- A mute only changes what the person who muted sees and hears:
--   * no notifications of any kind from them (notify(), which every
--     notification goes through, and comment_notification_recipients());
--   * their reviews leave For You and Following, and they're never
--     suggested (mentions, suggested reviewers, setup's people step);
--   * comment previews and "Liked by" skip them (review_previews()).
-- Comments fold in the app, and the song page and profile lists filter in
-- the app, from the muter's own user_mutes rows.
--
-- It doesn't unfollow anyone, doesn't change what the muted person can
-- see, and they can't find out: user_mutes rows are readable only by the
-- person who muted, and nothing here answers the muted person differently.

-- ---------------------------------------------------------------------------
-- 1. The mutes
-- ---------------------------------------------------------------------------

create table if not exists public.user_mutes (
  muter_id   uuid not null references public.profiles(id) on delete cascade,
  muted_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint user_mutes_not_self check (muter_id <> muted_id)
);

create index if not exists user_mutes_muted_idx on public.user_mutes (muted_id);

alter table public.user_mutes enable row level security;

-- Your own mutes only. There is deliberately no policy that lets the muted
-- person read a row about them.
drop policy if exists "Users read their own mutes" on public.user_mutes;
create policy "Users read their own mutes"
  on public.user_mutes for select
  to authenticated
  using ((select auth.uid()) = muter_id);

drop policy if exists "Users mute as themselves" on public.user_mutes;
create policy "Users mute as themselves"
  on public.user_mutes for insert
  to authenticated
  with check ((select auth.uid()) = muter_id);

drop policy if exists "Users unmute as themselves" on public.user_mutes;
create policy "Users unmute as themselves"
  on public.user_mutes for delete
  to authenticated
  using ((select auth.uid()) = muter_id);

-- The one check, for functions that act on other people's behalf.
-- Internal: over the API it would let anyone ask "has X muted me?".
create or replace function public.has_muted(muter uuid, muted uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select muter is not null and muted is not null and exists (
    select 1 from public.user_mutes um
     where um.muter_id = muter and um.muted_id = muted
  );
$$;

revoke all on function public.has_muted(uuid, uuid) from public;
revoke execute on function public.has_muted(uuid, uuid) from anon;
revoke execute on function public.has_muted(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notifications: nothing from someone you muted (0045 plus mutes)
-- ---------------------------------------------------------------------------

create or replace function public.notify(
  recipient_id uuid,
  actor_id     uuid,
  notif_type   text,
  payload      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if recipient_id is null or actor_id is null or recipient_id = actor_id then
    return;
  end if;

  -- Nothing from someone the recipient muted: every type comes through here.
  if public.has_muted(recipient_id, actor_id) then
    return;
  end if;

  select case notif_type
           when 'review_liked'     then p.review_liked
           when 'review_commented' then p.review_commented
           when 'thread_reply'     then p.thread_reply
           when 'comment_reply'    then p.comment_reply
           when 'mention'          then p.mention
           when 'comment_liked'    then p.comment_liked
           when 'playlist_liked'   then p.playlist_liked
           when 'new_follower'     then p.new_follower
           when 'follow_requested' then p.follow_requests
           when 'follow_accepted'  then p.follow_accepted
           when 'artist_release'   then p.artist_release
           else true
         end
    into allowed
    from public.notification_preferences p
   where p.user_id = recipient_id;

  if allowed is false then
    return;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (recipient_id, notif_type, payload || jsonb_build_object('actor_id', actor_id))
  on conflict do nothing;
end;
$$;

revoke all on function public.notify(uuid, uuid, text, jsonb) from public;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from anon;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who is told about a comment or a like (0043 plus mutes)
-- ---------------------------------------------------------------------------

create or replace function public.comment_notification_recipients(
  target_comment uuid,
  event          text,
  actor_id       uuid
)
returns table (recipient_id uuid, notif_type text)
language sql
security definer
set search_path = ''
stable
as $$
  with c as (
    select cm.id, cm.review_id, cm.user_id, cm.parent_id, cm.reply_to_id, r.user_id as review_author
      from public.review_comments cm
      join public.reviews r on r.id = cm.review_id
     where cm.id = target_comment
  ),
  candidates as (
    -- Likes
    select c.user_id as who, 'comment_liked'::text as kind, 5 as rank
      from c where event = 'like'
    union all
    -- The comment that was replied to
    select t.user_id, 'comment_reply', 1
      from c join public.review_comments t on t.id = c.reply_to_id
     where event = 'comment' and c.parent_id is not null and t.deleted_at is null
    union all
    -- Mentions
    select m.user_id, 'mention', 2
      from c join public.comment_mentions m on m.comment_id = c.id
     where event = 'comment'
    union all
    -- A new top-level comment tells the review's author
    select c.review_author, 'review_commented', 3
      from c where event = 'comment' and c.parent_id is null
    union all
    -- Everyone else in the thread
    select t.user_id, 'thread_reply', 4
      from c
      join public.review_comments t
        on (t.id = c.parent_id or t.parent_id = c.parent_id)
     where event = 'comment'
       and c.parent_id is not null
       and t.id <> c.id
       and t.deleted_at is null
  ),
  best as (
    select distinct on (who) who, kind
      from candidates
     where who is not null
     order by who, rank
  )
  select b.who, b.kind
    from best b, c
   where b.who <> actor_id
     and public.review_visible_to(c.review_id, b.who)
     -- Not anyone who muted whoever is acting.
     and not public.has_muted(b.who, actor_id)
     and not (
       b.kind = 'thread_reply'
       and exists (
         select 1 from public.notifications n
          where n.user_id = b.who
            and n.type = 'thread_reply'
            and n.payload ->> 'thread_id' = c.parent_id::text
            and n.created_at > now() - interval '1 hour'
       )
     );
$$;

revoke all on function public.comment_notification_recipients(uuid, text, uuid) from public;
revoke execute on function public.comment_notification_recipients(uuid, text, uuid) from anon;
revoke execute on function public.comment_notification_recipients(uuid, text, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who can be suggested after "@" (0043 plus mutes)
-- ---------------------------------------------------------------------------

create or replace function public.mention_suggestions(
  target_review uuid,
  query         text default '',
  max_results   int default 5
)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  reason       text
)
language sql
security definer
set search_path = ''
stable
as $$
  with me as (select auth.uid() as id),
  review as (
    select r.id, r.user_id,
           coalesce((select p.is_private from public.profiles p where p.id = r.user_id), false) as private
      from public.reviews r
     where r.id = target_review
       and (select id from me) is not null
       and public.review_visible_to(r.id, (select id from me))
  ),
  q as (select lower(trim(leading '@' from coalesce(query, ''))) as text),
  candidates as (
    select c.user_id as who, 1 as tier, 'thread' as reason
      from public.review_comments c, review
     where c.review_id = review.id and c.deleted_at is null
    union all
    select review.user_id, 1, 'thread' from review
    union all
    select f.following_id, 2, 'following'
      from public.user_follows f, me
     where f.follower_id = me.id and f.status = 'accepted'
    union all
    select f.follower_id, 3, 'follower'
      from public.user_follows f, me
     where f.following_id = me.id and f.status = 'accepted'
    union all
    select p.id, 4, null
      from public.profiles p, q, review
     where q.text <> ''
       and not review.private
       and (
         strpos(p.username, q.text) > 0
         or strpos(lower(coalesce(p.display_name, '')), q.text) > 0
       )
  ),
  best as (
    select distinct on (who) who, tier, reason
      from candidates
     where who is not null
     order by who, tier
  )
  select p.id, p.username, p.display_name, p.avatar_url, b.reason
    from best b
    join public.profiles p on p.id = b.who
    cross join q
   where b.who <> (select id from me)
     -- Never someone you muted.
     and not public.has_muted((select id from me), b.who)
     and (
       q.text = ''
       or strpos(p.username, q.text) > 0
       or strpos(lower(coalesce(p.display_name, '')), q.text) > 0
     )
     and public.review_visible_to(target_review, b.who)
   order by
     b.tier,
     -- Starts with what was typed, before merely containing it.
     (strpos(p.username, q.text) = 1 or strpos(lower(coalesce(p.display_name, '')), q.text) = 1) desc,
     p.username
   limit greatest(1, least(coalesce(max_results, 5), 10));
$$;

revoke all on function public.mention_suggestions(uuid, text, int) from public;
revoke execute on function public.mention_suggestions(uuid, text, int) from anon;
grant execute on function public.mention_suggestions(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Card previews and "Liked by" (0043 plus mutes)
-- ---------------------------------------------------------------------------

create or replace function public.review_previews(target_reviews uuid[])
returns table (
  review_id     uuid,
  comment_count int,
  top_comment   jsonb,
  commenters    jsonb,
  likers        jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    r.id,
    (select count(*) from public.review_comments c
      where c.review_id = r.id and c.deleted_at is null)::int,
    (
      select jsonb_build_object(
               'id', c.id,
               'user_id', c.user_id,
               'username', p.username,
               'display_name', p.display_name,
               'avatar_url', p.avatar_url,
               'body', c.body,
               'mentions', public.mention_people(c.body),
               'created_at', c.created_at,
               'like_count', (select count(*) from public.comment_likes l where l.comment_id = c.id),
               'liked_by_me', exists (
                 select 1 from public.comment_likes l
                  where l.comment_id = c.id and l.user_id = auth.uid()
               ),
               'is_author', c.user_id = r.user_id
             )
        from public.review_comments c
        join public.profiles p on p.id = c.user_id
       where c.review_id = r.id and c.parent_id is null and c.deleted_at is null
         -- The preview never leads with someone you muted.
         and not public.has_muted(auth.uid(), c.user_id)
       order by
         (select count(*) from public.comment_likes l where l.comment_id = c.id)
         + (select count(*) from public.review_comments x where x.parent_id = c.id) desc,
         c.created_at desc
       limit 1
    ),
    (
      select coalesce(jsonb_agg(x.person), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', p.id, 'username', p.username,
                   'display_name', p.display_name, 'avatar_url', p.avatar_url
                 ) as person
            from public.review_comments c
            join public.profiles p on p.id = c.user_id
           where c.review_id = r.id and c.deleted_at is null
             and not public.has_muted(auth.uid(), c.user_id)
           group by p.id
           order by max(c.created_at) desc
           limit 3
        ) x
    ),
    (
      select coalesce(jsonb_agg(x.person), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', p.id, 'username', p.username,
                   'display_name', p.display_name, 'avatar_url', p.avatar_url
                 ) as person
            from public.review_likes l
            join public.profiles p on p.id = l.user_id
           where l.review_id = r.id
             -- "Liked by" never shows someone you muted.
             and not public.has_muted(auth.uid(), l.user_id)
           order by l.created_at
           limit 2
        ) x
    )
  from public.reviews r
  -- Security definer for the same reason as review_thread(); this is the
  -- check that stands in for the table policies.
  where r.id = any (target_reviews)
    and public.can_view_review(r.id);
$$;

revoke all on function public.review_previews(uuid[]) from public;
grant execute on function public.review_previews(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. For You (0040 plus mutes)
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
       -- Not from someone you muted (your own mutes are readable to you).
       and not exists (
         select 1 from public.user_mutes um
          where um.muter_id = me.id and um.muted_id = r.user_id
       )
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

-- ---------------------------------------------------------------------------
-- 7. Following (0028 plus mutes)
-- ---------------------------------------------------------------------------

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
     -- Not from someone you muted. They stay followed.
     and not exists (
       select 1 from public.user_mutes um
        where um.muter_id = (select auth.uid()) and um.muted_id = r.user_id
     )
     and char_length(btrim(coalesce(r.body, ''))) >= min_chars
     and (
       before_at is null
       or r.created_at < before_at
       or (r.created_at = before_at and r.id < before_id)
     )
   order by r.created_at desc, r.id desc
   limit least(greatest(page_size, 1), 50);
$$;

revoke all on function public.feed_following(int, timestamptz, uuid, int) from public;
revoke execute on function public.feed_following(int, timestamptz, uuid, int) from anon;
grant execute on function public.feed_following(int, timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Suggested reviewers for the empty Following tab (0028 plus mutes)
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
     -- Never someone you muted.
     and not exists (
       select 1 from public.user_mutes um
        where um.muter_id = (select auth.uid()) and um.muted_id = p.id
     )
   group by p.id, p.username, p.display_name, p.avatar_url
   order by count(r.id) desc, max(r.created_at) desc
   limit least(greatest(max_count, 1), 20);
$$;

revoke all on function public.suggested_reviewers(int, int) from public;
revoke execute on function public.suggested_reviewers(int, int) from anon;
grant execute on function public.suggested_reviewers(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Suggested people in setup's step 4 (0039 plus mutes)
-- ---------------------------------------------------------------------------

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
       -- Never someone you muted.
       and not exists (
         select 1 from public.user_mutes um
          where um.muter_id = me.id and um.muted_id = p.id
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

revoke all on function public.suggested_reviewers_for_tags(text[], int) from public;
revoke execute on function public.suggested_reviewers_for_tags(text[], int) from anon;
grant execute on function public.suggested_reviewers_for_tags(text[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Unread counts per filter (0045 plus mutes)
-- ---------------------------------------------------------------------------

create or replace function public.notification_unread_counts()
returns table (category text, unread int)
language sql
security invoker
set search_path = ''
stable
as $$
  with mine as (
    select n.type,
           coalesce(
             n.group_key,
             case when n.type = 'playlist_liked' then 'playlist_liked:' || (n.payload ->> 'playlist_id') end,
             n.id::text
           ) as item
      from public.notifications n
     where n.user_id = auth.uid()
       and n.read = false
       and n.type <> 'follow_requested'
       -- Ones from someone you muted, sent before the mute, aren't shown,
       -- so they aren't counted either. Your own mutes are readable to you.
       and not exists (
         select 1 from public.user_mutes um
          where um.muter_id = auth.uid() and um.muted_id::text = n.payload ->> 'actor_id'
       )
  ),
  tagged as (
    select item,
           case
             when type = 'mention' then 'mentions'
             when type in ('comment_reply', 'thread_reply', 'review_commented') then 'replies'
             when type in ('review_liked', 'comment_liked', 'playlist_liked') then 'likes'
             when type in ('new_follower', 'follow_accepted') then 'follows'
             when type = 'artist_release' then 'artists'
             else 'other'
           end as category
      from mine
  )
  select 'all', count(distinct item)::int from tagged
  union all
  select f.name, count(distinct t.item)::int
    from unnest(array['mentions', 'replies', 'likes', 'follows', 'artists']) as f(name)
    left join tagged t on t.category = f.name
   group by f.name;
$$;

revoke all on function public.notification_unread_counts() from public;
revoke execute on function public.notification_unread_counts() from anon;
grant execute on function public.notification_unread_counts() to authenticated;
