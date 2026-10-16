-- Conversations: replies one level deep, likes on comments, @mentions, and
-- the notifications for all three.
--
-- Additive. Existing tables gain columns, triggers and functions; no rows are
-- removed or rewritten except that notifications gains a computed column.
--
--   review_comments          + parent_id, reply_to_id, deleted_at
--   notifications            + group_key (computed from type and payload)
--   notification_preferences + comment_reply, mention, comment_liked
--   new tables               comment_likes, comment_mentions
--
-- Two functions hold the rules other features will extend (muting is next):
--   comment_notification_recipients()  who is told about a comment or a like
--   mention_suggestions()              who can be suggested after "@"

-- ---------------------------------------------------------------------------
-- 1. Replies and the deleted placeholder
-- ---------------------------------------------------------------------------

-- parent_id: the top-level comment a reply sits under. Never deeper: a
--   reply's parent is always top level (enforced by the trigger below).
-- reply_to_id: the comment Reply was tapped on, which may itself be a reply.
--   It says who "replied to your comment" is for; parent_id says where the
--   reply is shown. The app sends only reply_to_id and the trigger works out
--   parent_id from it.
-- deleted_at: a top-level comment deleted while it has replies stays as a
--   "Comment deleted" placeholder so the replies keep their place.
alter table public.review_comments
  add column if not exists parent_id   uuid references public.review_comments(id) on delete cascade,
  add column if not exists reply_to_id uuid references public.review_comments(id) on delete set null,
  add column if not exists deleted_at  timestamptz;

create index if not exists review_comments_parent_idx
  on public.review_comments (parent_id, created_at)
  where parent_id is not null;

create or replace function public.check_comment_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  if tg_op = 'UPDATE' then
    -- A comment never moves to another review or thread.
    if new.review_id is distinct from old.review_id
       or new.parent_id is distinct from old.parent_id
       or new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null then
      raise exception 'A comment can''t be moved.' using errcode = 'check_violation';
    end if;
    -- Only the delete trigger (one level down) sets or clears deleted_at.
    if new.deleted_at is distinct from old.deleted_at and pg_trigger_depth() <= 1 then
      raise exception 'Delete the comment instead.' using errcode = 'check_violation';
    end if;
    if old.deleted_at is not null and new.body is distinct from old.body and pg_trigger_depth() <= 1 then
      raise exception 'A deleted comment can''t be edited.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.deleted_at is not null then
    raise exception 'A new comment can''t start deleted.' using errcode = 'check_violation';
  end if;

  if new.reply_to_id is not null then
    select id, review_id, parent_id, deleted_at into target
      from public.review_comments where id = new.reply_to_id;
    if not found or target.review_id <> new.review_id then
      raise exception 'That comment isn''t on this review.' using errcode = 'check_violation';
    end if;
    if target.deleted_at is not null then
      raise exception 'That comment was deleted.' using errcode = 'check_violation';
    end if;
    -- Replying to a reply lands under the same top-level comment.
    new.parent_id := coalesce(target.parent_id, target.id);
  elsif new.parent_id is not null then
    -- No reply_to_id given: the reply is to the parent itself.
    new.reply_to_id := new.parent_id;
  end if;

  if new.parent_id is not null then
    select id, review_id, parent_id, deleted_at into target
      from public.review_comments where id = new.parent_id;
    if not found or target.review_id <> new.review_id then
      raise exception 'That comment isn''t on this review.' using errcode = 'check_violation';
    end if;
    if target.parent_id is not null then
      raise exception 'Replies are one level deep.' using errcode = 'check_violation';
    end if;
    if target.deleted_at is not null then
      raise exception 'That comment was deleted.' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists review_comments_thread on public.review_comments;
create trigger review_comments_thread
  before insert or update on public.review_comments
  for each row execute function public.check_comment_thread();

-- Deleting a top-level comment that has replies leaves the placeholder:
-- the text, its likes and mentions go, the row stays. Without replies it's
-- deleted for real. Plain DELETE does the right thing, so nothing in the
-- API can remove other people's replies by deleting their parent.
--
-- pg_trigger_depth() = 1 is a delete someone asked for. Deeper is a
-- cascade (the review itself being deleted), which must go through.
create or replace function public.soft_delete_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or old.parent_id is not null then
    return old;
  end if;
  if not exists (select 1 from public.review_comments r where r.parent_id = old.id) then
    return old;
  end if;
  if old.deleted_at is null then
    update public.review_comments
       set deleted_at = now(), body = '', edited = false
     where id = old.id;
    delete from public.comment_likes where comment_id = old.id;
    delete from public.comment_mentions where comment_id = old.id;
    delete from public.notifications
     where read = false and payload ->> 'comment_id' = old.id::text;
  end if;
  -- Keep the row.
  return null;
end;
$$;

drop trigger if exists review_comments_soft_delete on public.review_comments;
create trigger review_comments_soft_delete
  before delete on public.review_comments
  for each row execute function public.soft_delete_comment();

-- The last reply under a placeholder takes the placeholder with it.
create or replace function public.clear_empty_placeholder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.parent_id is not null then
    delete from public.review_comments p
     where p.id = old.parent_id
       and p.deleted_at is not null
       and not exists (select 1 from public.review_comments r where r.parent_id = p.id);
  end if;
  return old;
end;
$$;

drop trigger if exists review_comments_clear_placeholder on public.review_comments;
create trigger review_comments_clear_placeholder
  after delete on public.review_comments
  for each row execute function public.clear_empty_placeholder();

-- ---------------------------------------------------------------------------
-- 2. Likes on comments and replies
-- ---------------------------------------------------------------------------

create table if not exists public.comment_likes (
  comment_id uuid not null references public.review_comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_likes_user_idx on public.comment_likes (user_id);

alter table public.comment_likes enable row level security;

drop policy if exists "Comment likes are visible with their review" on public.comment_likes;
create policy "Comment likes are visible with their review"
  on public.comment_likes for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.review_comments c
       where c.id = comment_id and public.can_view_review(c.review_id)
    )
  );

drop policy if exists "Users like comments as themselves" on public.comment_likes;
create policy "Users like comments as themselves"
  on public.comment_likes for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.review_comments c
       where c.id = comment_id
         and c.deleted_at is null
         and public.can_view_review(c.review_id)
    )
  );

drop policy if exists "Users remove their own comment likes" on public.comment_likes;
create policy "Users remove their own comment likes"
  on public.comment_likes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Mentions
-- ---------------------------------------------------------------------------

-- Written only by the comment trigger, from the comment's own text, so a
-- mention can't be faked or aimed at someone who can't see the review.
create table if not exists public.comment_mentions (
  comment_id uuid not null references public.review_comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_mentions_user_idx on public.comment_mentions (user_id);

alter table public.comment_mentions enable row level security;

drop policy if exists "Mentions are visible with their review" on public.comment_mentions;
create policy "Mentions are visible with their review"
  on public.comment_mentions for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.review_comments c
       where c.id = comment_id and public.can_view_review(c.review_id)
    )
  );
-- No insert, update or delete policies: the trigger is the only writer.

-- How a mention is stored in the text: <@user-id>. The app shows the
-- person's current @username there, so a rename never breaks a mention.
--
-- People type plain "@name". On save, each one that is a real user who can
-- see the review becomes a stored mention:
--   * capitals don't matter ("@Toji" is @toji);
--   * punctuation after the name isn't part of it ("@toji," "@toji!");
--   * usernames can contain dots, so "@toji." is the longest real username
--     it can be: "toji." if that exists, otherwise "toji" and a full stop;
--   * an "@" straight after a letter, digit, "_" or "." is part of a word
--     (an email address) and is left alone;
--   * an unknown name, or someone who can't see the review, stays as plain
--     text.
-- Stored mentions already in the text are checked the same way, so one
-- can't be typed in by hand for someone who isn't allowed.
create or replace function public.resolve_mentions(body text, target_review uuid)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  out_text  text := '';
  rest      text := body;
  token     text;
  token_id  uuid;
  handle    text;
  candidate text;
  found_id  uuid;
  pos       int;
  prev      text;
begin
  if body is null or position('@' in body) = 0 then
    return body;
  end if;

  -- Stored mentions: keep the ones that are still allowed, write the rest
  -- back out as plain @username.
  for token in select distinct m[1] from regexp_matches(body, '<@([0-9a-f-]{36})>', 'g') as m loop
    token_id := token::uuid;
    if not exists (select 1 from public.profiles p where p.id = token_id)
       or not public.review_visible_to(target_review, token_id) then
      rest := replace(
        rest,
        '<@' || token || '>',
        '@' || coalesce((select p.username from public.profiles p where p.id = token_id), 'someone')
      );
    end if;
  end loop;

  -- Typed @names, left to right.
  loop
    pos := regexp_instr(rest, '@[A-Za-z0-9_.]+');
    exit when pos = 0;
    prev := case when pos > 1 then substr(rest, pos - 1, 1) else '' end;
    handle := substring(substr(rest, pos + 1) from '^[A-Za-z0-9_.]+');

    found_id := null;
    if prev !~ '[A-Za-z0-9_.@<]' then
      candidate := lower(handle);
      -- Longest real username first: drop trailing dots one at a time.
      loop
        select p.id into found_id
          from public.profiles p
         where p.username = candidate
           and public.review_visible_to(target_review, p.id);
        exit when found_id is not null or right(candidate, 1) <> '.';
        candidate := left(candidate, length(candidate) - 1);
      end loop;
    end if;

    if found_id is not null then
      out_text := out_text || substr(rest, 1, pos - 1) || '<@' || found_id::text || '>';
      rest := substr(rest, pos + 1 + length(candidate));
    else
      -- Not a mention: keep the "@" and the name exactly as typed.
      out_text := out_text || substr(rest, 1, pos + length(handle));
      rest := substr(rest, pos + 1 + length(handle));
    end if;
  end loop;

  return out_text || rest;
end;
$$;

revoke all on function public.resolve_mentions(text, uuid) from public;
revoke execute on function public.resolve_mentions(text, uuid) from anon;
revoke execute on function public.resolve_mentions(text, uuid) from authenticated;

create or replace function public.store_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.body is distinct from old.body then
    new.body := public.resolve_mentions(new.body, new.review_id);
  end if;
  return new;
end;
$$;

-- Named to run after review_comments_thread: triggers on the same event run
-- in name order.
drop trigger if exists review_comments_zz_mentions on public.review_comments;
create trigger review_comments_zz_mentions
  before insert or update of body on public.review_comments
  for each row execute function public.store_comment_mentions();

-- The mentions table always matches the text. Mentioning yourself is a
-- chip and a link, but not a mention: nobody needs telling.
create or replace function public.sync_comment_mentions(target_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select id, user_id, body into c from public.review_comments where id = target_comment;
  if not found then return; end if;

  delete from public.comment_mentions m
   where m.comment_id = c.id
     and m.user_id::text not in (
       select t[1] from regexp_matches(c.body, '<@([0-9a-f-]{36})>', 'g') as t
     );

  insert into public.comment_mentions (comment_id, user_id)
  select distinct c.id, t[1]::uuid
    from regexp_matches(c.body, '<@([0-9a-f-]{36})>', 'g') as t
   where t[1]::uuid <> c.user_id
  on conflict do nothing;
end;
$$;

revoke all on function public.sync_comment_mentions(uuid) from public;
revoke execute on function public.sync_comment_mentions(uuid) from anon;
revoke execute on function public.sync_comment_mentions(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notifications: types, switches, grouping
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  add column if not exists comment_reply boolean not null default true,
  add column if not exists mention       boolean not null default true,
  add column if not exists comment_liked boolean not null default true;

-- Rows that show as one line on the notifications page share a group_key:
-- likes on the same review, likes on the same comment. Computed, so every
-- existing row has it with nothing to backfill.
alter table public.notifications
  add column if not exists group_key text generated always as (
    case type
      when 'review_liked'  then 'review_liked:'  || (payload ->> 'review_id')
      when 'comment_liked' then 'comment_liked:' || (payload ->> 'comment_id')
    end
  ) stored;

create index if not exists notifications_group_idx
  on public.notifications (user_id, group_key)
  where group_key is not null;

-- One like notification per person per comment, ever: like, unlike, like
-- doesn't add a second row.
create unique index if not exists notifications_one_like_per_comment
  on public.notifications (user_id, (payload ->> 'actor_id'), (payload ->> 'comment_id'))
  where type = 'comment_liked';

-- notify() with the three new switches. Everything else is unchanged from
-- 0027, restated because create or replace needs the whole body.
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

  select case notif_type
           when 'review_liked'     then p.review_liked
           when 'review_commented' then p.review_commented
           when 'thread_reply'     then p.thread_reply
           when 'comment_reply'    then p.comment_reply
           when 'mention'          then p.mention
           when 'comment_liked'    then p.comment_liked
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
-- 5. Who gets notified: the one place
-- ---------------------------------------------------------------------------

-- event 'comment': a comment or reply was just posted (actor = its author).
-- event 'like':    actor just liked the comment.
--
-- Each person gets at most one notification per event, the most specific:
--   comment_reply     the comment Reply was tapped on was theirs
--   mention           they were mentioned
--   review_commented  a new top-level comment on their review
--   thread_reply      a reply in a thread they're in (they wrote the
--                     top-level comment or a reply under it), at most once
--                     per thread per hour
--   comment_liked     their comment or reply was liked
-- Never the actor, and never anyone who can't see the review.
-- Muting (next) is a filter here.
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

-- A new comment: store its mentions, then tell whoever should know.
create or replace function public.on_review_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  who     record;
  payload jsonb;
begin
  perform public.sync_comment_mentions(new.id);

  select id, user_id, song_id into r from public.reviews where id = new.review_id;
  if not found then return new; end if;

  payload := jsonb_build_object(
    'review_id',        r.id,
    'song_id',          r.song_id,
    'comment_id',       new.id,
    'thread_id',        coalesce(new.parent_id, new.id),
    'review_author_id', r.user_id
  );

  for who in select * from public.comment_notification_recipients(new.id, 'comment', new.user_id) loop
    perform public.notify(who.recipient_id, new.user_id, who.notif_type, payload);
  end loop;
  return new;
end;
$$;

drop trigger if exists on_review_comment_insert on public.review_comments;
create trigger on_review_comment_insert
  after insert on public.review_comments
  for each row execute function public.on_review_comment();

-- An edit keeps the mentions table in step with the text. Edits don't
-- notify anyone.
create or replace function public.on_review_comment_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_comment_mentions(new.id);
  return new;
end;
$$;

drop trigger if exists on_review_comment_edit on public.review_comments;
create trigger on_review_comment_edit
  after update of body on public.review_comments
  for each row execute function public.on_review_comment_edit();

-- A deleted comment takes its unread notifications with it, every type.
create or replace function public.on_review_comment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
   where read = false
     and type in ('review_commented', 'thread_reply', 'comment_reply', 'mention', 'comment_liked')
     and payload ->> 'comment_id' = old.id::text;
  return old;
end;
$$;

drop trigger if exists on_review_comment_delete on public.review_comments;
create trigger on_review_comment_delete
  after delete on public.review_comments
  for each row execute function public.on_review_comment_delete();

-- Liking a comment tells its author; unliking removes it while unread.
create or replace function public.on_comment_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   record;
  who record;
begin
  select cm.id, cm.review_id, coalesce(cm.parent_id, cm.id) as thread_id, r.song_id
    into c
    from public.review_comments cm
    join public.reviews r on r.id = cm.review_id
   where cm.id = new.comment_id;
  if not found then return new; end if;

  for who in select * from public.comment_notification_recipients(new.comment_id, 'like', new.user_id) loop
    perform public.notify(
      who.recipient_id,
      new.user_id,
      who.notif_type,
      jsonb_build_object(
        'review_id',  c.review_id,
        'song_id',    c.song_id,
        'comment_id', c.id,
        'thread_id',  c.thread_id
      )
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists on_comment_like_insert on public.comment_likes;
create trigger on_comment_like_insert
  after insert on public.comment_likes
  for each row execute function public.on_comment_like();

create or replace function public.on_comment_unlike()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
   where type = 'comment_liked'
     and read = false
     and payload ->> 'actor_id' = old.user_id::text
     and payload ->> 'comment_id' = old.comment_id::text;
  return old;
end;
$$;

drop trigger if exists on_comment_like_delete on public.comment_likes;
create trigger on_comment_like_delete
  after delete on public.comment_likes
  for each row execute function public.on_comment_unlike();

-- ---------------------------------------------------------------------------
-- 6. Reading a thread, the card previews, and mention suggestions
-- ---------------------------------------------------------------------------

-- Mentioned people in a piece of text, with their current names. Only
-- people the caller can see the profile of get names; anyone else shows as
-- "someone" (the app renders that as plain text, not a chip).
create or replace function public.mention_people(body text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name
    )),
    '[]'::jsonb
  )
  from regexp_matches(coalesce(body, ''), '<@([0-9a-f-]{36})>', 'g') as t
  join public.profiles p on p.id = t[1]::uuid;
$$;

revoke all on function public.mention_people(text) from public;
grant execute on function public.mention_people(text) to anon, authenticated;

-- One request for a whole thread. Top-level comments in the chosen order
-- (top: likes plus replies, then newest; newest: newest first), each
-- followed by its replies oldest first, so the list reads as a
-- conversation. Placeholders without replies never appear (they're deleted
-- for real), and placeholders carry no text, likes or author.
--
-- Security definer with an explicit can_view_review() check rather than
-- relying on table policies: logged-out visitors may read the comments on
-- a public account's review even though they can't read reviews.
create or replace function public.review_thread(target_review uuid, sort text default 'top')
returns table (
  id             uuid,
  parent_id      uuid,
  reply_to_id    uuid,
  user_id        uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  body           text,
  mentions       jsonb,
  created_at     timestamptz,
  edited         boolean,
  deleted        boolean,
  like_count     int,
  liked_by_me    boolean,
  author_liked   boolean,
  reply_count    int,
  is_author      boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  with review as (
    select r.id, r.user_id from public.reviews r
     where r.id = target_review and public.can_view_review(r.id)
  ),
  thread_rows as (
    select c.*,
           (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
           (select count(*) from public.review_comments x where x.parent_id = c.id)::int as replies
      from public.review_comments c, review
     where c.review_id = review.id
  ),
  tops as (
    select thread_rows.id,
           row_number() over (
             order by
               case when sort = 'newest' then 0 else thread_rows.likes + thread_rows.replies end desc,
               thread_rows.created_at desc
           ) as place
      from thread_rows where thread_rows.parent_id is null
  )
  select
    c.id,
    c.parent_id,
    c.reply_to_id,
    case when c.deleted_at is null then c.user_id end,
    case when c.deleted_at is null then p.username end,
    case when c.deleted_at is null then p.display_name end,
    case when c.deleted_at is null then p.avatar_url end,
    case when c.deleted_at is null then c.body else '' end,
    case when c.deleted_at is null then public.mention_people(c.body) else '[]'::jsonb end,
    c.created_at,
    c.edited,
    c.deleted_at is not null,
    c.likes,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    exists (
      select 1 from public.comment_likes l, review
       where l.comment_id = c.id and l.user_id = review.user_id
    ),
    c.replies,
    c.deleted_at is null and c.user_id = (select review.user_id from review)
  from thread_rows c
  join tops t on t.id = coalesce(c.parent_id, c.id)
  left join public.profiles p on p.id = c.user_id
  order by t.place, (c.parent_id is not null), c.created_at;
$$;

revoke all on function public.review_thread(uuid, text) from public;
grant execute on function public.review_thread(uuid, text) to anon, authenticated;

-- Everything a collapsed card needs, for a whole page of reviews at once:
-- the comment count (replies included, placeholders not), the top comment,
-- two other commenters' avatars for "View all", and the first two people
-- who liked the review for "Liked by".
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

-- Who can be suggested after "@": the one place. Muting (next) is a
-- filter here.
--
-- Order: people in this review's comments, people you follow, people who
-- follow you, then anyone else whose username or name matches. Closer
-- matches first in each group (the name starts with what you typed before
-- it merely contains it). Never you, and never anyone who can't see the
-- review. On a private account's review "anyone else" is left out, so the
-- list can't be used to find out who else follows that account.
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
-- 7. Unread counts for the notification filters
-- ---------------------------------------------------------------------------

-- A group (several likes on one thing) counts once, the way the page shows
-- it. follow_requested is left out like on the page: requests have their
-- own row. Announcements live in their own table and are added by the app.
create or replace function public.notification_unread_counts()
returns table (category text, unread int)
language sql
security invoker
set search_path = ''
stable
as $$
  with mine as (
    select n.type, coalesce(n.group_key, n.id::text) as item
      from public.notifications n
     where n.user_id = auth.uid()
       and n.read = false
       and n.type <> 'follow_requested'
  ),
  tagged as (
    select item,
           case
             when type = 'mention' then 'mentions'
             when type in ('comment_reply', 'thread_reply', 'review_commented') then 'replies'
             when type in ('review_liked', 'comment_liked') then 'likes'
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
