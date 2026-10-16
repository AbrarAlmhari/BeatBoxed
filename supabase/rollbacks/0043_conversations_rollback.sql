-- Undoes migrations/0043_conversations.sql. Run by hand only, together with
-- reverting the frontend (the threads, comment likes, mentions and the new
-- notifications page read everything below). Run before 0042's rollback.
--
-- Lost: every like on a comment, the mentions table, which comment a reply
-- belongs to (replies become ordinary comments, oldest first, as before),
-- and the three new notification switches. "Comment deleted" placeholders
-- are removed, since the comment they stood for is already gone. Mentions
-- in comment text are written back out as plain @username so no comment
-- shows a raw id. Notifications of the new types stay but the old page
-- doesn't show them.
begin;

drop function if exists public.notification_unread_counts();
drop function if exists public.mention_suggestions(uuid, text, int);
drop function if exists public.review_previews(uuid[]);
drop function if exists public.review_thread(uuid, text);
drop function if exists public.mention_people(text);

drop trigger if exists on_comment_like_delete on public.comment_likes;
drop trigger if exists on_comment_like_insert on public.comment_likes;
drop function if exists public.on_comment_unlike();
drop function if exists public.on_comment_like();

drop trigger if exists on_review_comment_edit on public.review_comments;
drop function if exists public.on_review_comment_edit();

drop trigger if exists review_comments_zz_mentions on public.review_comments;
drop function if exists public.store_comment_mentions();
drop function if exists public.sync_comment_mentions(uuid);
drop function if exists public.resolve_mentions(text, uuid);

drop trigger if exists review_comments_clear_placeholder on public.review_comments;
drop function if exists public.clear_empty_placeholder();
drop trigger if exists review_comments_soft_delete on public.review_comments;
drop function if exists public.soft_delete_comment();
drop trigger if exists review_comments_thread on public.review_comments;
drop function if exists public.check_comment_thread();

-- Mentions back to plain text, now that no trigger turns them into
-- stored mentions again.
do $$
declare
  c record;
  t text;
begin
  for c in
    select id, body from public.review_comments where body ~ '<@[0-9a-f-]{36}>'
  loop
    for t in
      select distinct m[1] from regexp_matches(c.body, '<@([0-9a-f-]{36})>', 'g') as m
    loop
      c.body := replace(
        c.body,
        '<@' || t || '>',
        '@' || coalesce((select p.username from public.profiles p where p.id = t::uuid), 'someone')
      );
    end loop;
    update public.review_comments set body = c.body where id = c.id;
  end loop;
end
$$;

-- The placeholders, then the reply structure.
delete from public.review_comments where deleted_at is not null;
alter table public.review_comments drop column if exists deleted_at;
alter table public.review_comments drop column if exists reply_to_id;
drop index if exists public.review_comments_parent_idx;
alter table public.review_comments drop column if exists parent_id;

drop table if exists public.comment_mentions;
drop table if exists public.comment_likes;

drop index if exists public.notifications_one_like_per_comment;
drop index if exists public.notifications_group_idx;
alter table public.notifications drop column if exists group_key;

alter table public.notification_preferences drop column if exists comment_liked;
alter table public.notification_preferences drop column if exists mention;
alter table public.notification_preferences drop column if exists comment_reply;

-- 0014's comment notifications, as they were.
create or replace function public.on_review_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  other_id   uuid;
  base       jsonb;
begin
  select id, user_id, song_id into r
  from public.reviews where id = new.review_id;
  if not found then return new; end if;

  base := jsonb_build_object(
    'review_id',  r.id,
    'song_id',    r.song_id,
    'comment_id', new.id,
    'review_author_id', r.user_id
  );

  perform public.notify(r.user_id, new.user_id, 'review_commented', base);

  for other_id in
    select distinct c.user_id
    from public.review_comments c
    where c.review_id = new.review_id
      and c.user_id <> new.user_id
      and c.user_id <> r.user_id
  loop
    perform public.notify(other_id, new.user_id, 'thread_reply', base);
  end loop;

  return new;
end;
$$;

create or replace function public.on_review_comment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
  where read = false
    and type in ('review_commented', 'thread_reply')
    and payload ->> 'comment_id' = old.id::text;
  return old;
end;
$$;

-- 0027's notify(), as it was.
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

commit;
