-- Notifications for likes, comments and thread replies.
--
-- Everything goes through notify() so a future social type — playlist likes,
-- follows — is a trigger that calls it plus one renderer, with no new rules
-- about self-notification or payload shape to re-derive.

-- ---------------------------------------------------------------------------
-- 1. The shared helper
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
begin
  -- Nobody needs telling about their own action.
  if recipient_id is null or actor_id is null or recipient_id = actor_id then
    return;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (recipient_id, notif_type, payload || jsonb_build_object('actor_id', actor_id))
  -- Covers like -> unlike -> like: the partial index below keeps one row.
  on conflict do nothing;
end;
$$;

revoke all on function public.notify(uuid, uuid, text, jsonb) from public;

-- One like notification per person per review, ever. Re-liking after an
-- unlike must not produce a second row.
create unique index if not exists notifications_one_like_per_review
  on public.notifications (
    user_id,
    (payload ->> 'actor_id'),
    (payload ->> 'review_id')
  )
  where type = 'review_liked';

-- ---------------------------------------------------------------------------
-- 2. Likes
-- ---------------------------------------------------------------------------
create or replace function public.on_review_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select id, user_id, song_id into r
  from public.reviews where id = new.review_id;
  if not found then return new; end if;

  perform public.notify(
    r.user_id,
    new.user_id,
    'review_liked',
    jsonb_build_object('review_id', r.id, 'song_id', r.song_id)
  );
  return new;
end;
$$;

drop trigger if exists on_review_like_insert on public.review_likes;
create trigger on_review_like_insert
  after insert on public.review_likes
  for each row execute function public.on_review_like();

-- Undo removes the notification, but only while it's still unread: pulling
-- something the recipient already saw is more confusing than leaving it.
create or replace function public.on_review_unlike()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
  where type = 'review_liked'
    and read = false
    and payload ->> 'actor_id' = old.user_id::text
    and payload ->> 'review_id' = old.review_id::text;
  return old;
end;
$$;

drop trigger if exists on_review_like_delete on public.review_likes;
create trigger on_review_like_delete
  after delete on public.review_likes
  for each row execute function public.on_review_unlike();

-- ---------------------------------------------------------------------------
-- 3. Comments, and replies to a thread you're already in
-- ---------------------------------------------------------------------------
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
    -- Lets the renderer say "Omar's review" without a second lookup.
    'review_author_id', r.user_id
  );

  perform public.notify(r.user_id, new.user_id, 'review_commented', base);

  -- Everyone else already in the thread, minus the review author who just
  -- got the more specific notification above.
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

drop trigger if exists on_review_comment_insert on public.review_comments;
create trigger on_review_comment_insert
  after insert on public.review_comments
  for each row execute function public.on_review_comment();

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

drop trigger if exists on_review_comment_delete on public.review_comments;
create trigger on_review_comment_delete
  after delete on public.review_comments
  for each row execute function public.on_review_comment_delete();
