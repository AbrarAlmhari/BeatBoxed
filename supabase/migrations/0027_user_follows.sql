-- One-way follows between people, replacing mutual friendships.
--
-- Following a public account is instant. Following a private account sends
-- a request the owner accepts or declines. Accepted followers are who a
-- private account is visible to, so can_view_profile() now asks
-- user_follows instead of friendships.
--
-- Separate from `follows`, which is artist follows and is unchanged.
--
-- friendships, request_friendship(), friend_count() and get_friends() are
-- deliberately left in place, untouched, until the conversion below has been
-- checked against them. The app stops calling them with this change; a later
-- migration drops them.

-- All or nothing: if any statement fails, the whole migration rolls back
-- and the database is left exactly as it was. Nothing below needs to run
-- outside a transaction (no CREATE INDEX CONCURRENTLY, no enum changes).
-- Undo with supabase/rollbacks/0027_user_follows_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.user_follows (
  follower_id  uuid not null,
  following_id uuid not null,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  -- One row per ordered pair: a repeated tap can't stack duplicate follows.
  constraint user_follows_pkey primary key (follower_id, following_id),
  -- Named so PostgREST embeds can pick a side unambiguously.
  constraint user_follows_follower_id_fkey
    foreign key (follower_id) references public.profiles(id) on delete cascade,
  constraint user_follows_following_id_fkey
    foreign key (following_id) references public.profiles(id) on delete cascade,
  constraint user_follows_status_check check (status in ('pending', 'accepted')),
  constraint user_follows_no_self check (follower_id <> following_id)
);

-- "Who follows me" and "my pending requests" both start from the followed side.
create index if not exists user_follows_following_idx
  on public.user_follows (following_id, status);
create index if not exists user_follows_follower_idx
  on public.user_follows (follower_id, status);

-- ---------------------------------------------------------------------------
-- 2. Status is decided by the database, not the client
--
-- A client could otherwise insert status = 'accepted' straight onto a
-- private account. Whatever the insert says, the target's privacy wins.
-- security definer because it reads someone else's profiles row.
-- ---------------------------------------------------------------------------

create or replace function public.user_follows_set_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.status := case
    when coalesce(
      (select p.is_private from public.profiles p where p.id = new.following_id),
      false
    ) then 'pending'
    else 'accepted'
  end;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists user_follows_set_status on public.user_follows;
create trigger user_follows_set_status
  before insert on public.user_follows
  for each row execute function public.user_follows_set_status();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.user_follows enable row level security;

-- Private to the two people in a row, like friendships was. Other people's
-- lists are read through get_followers() / get_following(), which apply the
-- privacy and list-visibility rules.
drop policy if exists "Follows are visible to both people" on public.user_follows;
create policy "Follows are visible to both people"
  on public.user_follows for select to authenticated
  using ((select auth.uid()) in (follower_id, following_id));

drop policy if exists "Users follow as themselves" on public.user_follows;
create policy "Users follow as themselves"
  on public.user_follows for insert to authenticated
  with check ((select auth.uid()) = follower_id);

-- Only the followed person can accept, and accepting is the only update.
drop policy if exists "The followed person accepts requests" on public.user_follows;
create policy "The followed person accepts requests"
  on public.user_follows for update to authenticated
  using ((select auth.uid()) = following_id)
  with check ((select auth.uid()) = following_id and status = 'accepted');

-- Unfollow, cancel a request, decline a request, or remove a follower.
drop policy if exists "Either side removes a follow" on public.user_follows;
create policy "Either side removes a follow"
  on public.user_follows for delete to authenticated
  using ((select auth.uid()) in (follower_id, following_id));

-- The update policy can't stop someone rewriting follower_id or following_id
-- on a row they're allowed to update, so only the status column is
-- updatable at all.
revoke all on table public.user_follows from anon;
revoke update on table public.user_follows from authenticated;
grant update (status) on table public.user_follows to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The shared privacy rule
-- ---------------------------------------------------------------------------

-- The one place "is an accepted follower" is defined. can_view_profile()
-- uses it, and the review feed will call it directly.
--
-- viewer_id defaults to the caller. A different viewer is answered only for
-- the service role (no auth.uid()); for anyone signed in it returns false,
-- so the function can't be used over RPC to discover who follows whom on an
-- account whose lists are hidden.
create or replace function public.viewer_follows(
  author_id uuid,
  viewer_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    author_id is not null
    and viewer_id is not null
    and (auth.uid() is null or viewer_id = auth.uid())
    and exists (
      select 1
        from public.user_follows uf
       where uf.follower_id = viewer_id
         and uf.following_id = author_id
         and uf.status = 'accepted'
    );
$$;

revoke all on function public.viewer_follows(uuid, uuid) from public;
revoke execute on function public.viewer_follows(uuid, uuid) from anon;
grant execute on function public.viewer_follows(uuid, uuid) to authenticated;

-- Same signature and meaning as 0022, with accepted followers in place of
-- accepted friends. Every select policy that calls it -- reviews, playlists,
-- playlist_songs, follows -- picks this up without being touched.
create or replace function public.can_view_profile(viewer_id uuid, owner_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    viewer_id is not null
    and owner_id is not null
    and (
      viewer_id = owner_id
      or not coalesce(
        (select p.is_private from public.profiles p where p.id = owner_id),
        false
      )
      or public.viewer_follows(owner_id, viewer_id)
    );
$$;

revoke all on function public.can_view_profile(uuid, uuid) from public;
revoke execute on function public.can_view_profile(uuid, uuid) from anon;
grant execute on function public.can_view_profile(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lists and counts
-- ---------------------------------------------------------------------------

-- Someone's accepted followers / who they follow. friends_list_visible now
-- governs both lists; a private account's lists are followers-only, like
-- everything else on it. Pending requests never appear here.
create or replace function public.get_followers(target uuid)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.username, p.display_name, p.avatar_url
    from public.user_follows uf
    join public.profiles p on p.id = uf.follower_id
   where uf.following_id = target
     and uf.status = 'accepted'
     and public.can_view_profile((select auth.uid()), target)
     and (
       coalesce(
         (select pr.friends_list_visible from public.profiles pr where pr.id = target),
         true
       )
       or (select auth.uid()) = target
     )
   order by lower(coalesce(p.display_name, p.username, ''));
$$;

create or replace function public.get_following(target uuid)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.username, p.display_name, p.avatar_url
    from public.user_follows uf
    join public.profiles p on p.id = uf.following_id
   where uf.follower_id = target
     and uf.status = 'accepted'
     and public.can_view_profile((select auth.uid()), target)
     and (
       coalesce(
         (select pr.friends_list_visible from public.profiles pr where pr.id = target),
         true
       )
       or (select auth.uid()) = target
     )
   order by lower(coalesce(p.display_name, p.username, ''));
$$;

revoke all on function public.get_followers(uuid) from public;
revoke execute on function public.get_followers(uuid) from anon;
grant execute on function public.get_followers(uuid) to authenticated;
revoke all on function public.get_following(uuid) from public;
revoke execute on function public.get_following(uuid) from anon;
grant execute on function public.get_following(uuid) to authenticated;

-- The profile header's two numbers. Like friend_count(), a private profile
-- shows its counts to everyone; only the people behind them are hidden.
-- Named follow_counts because following_count() already exists and counts
-- followed artists.
create or replace function public.follow_counts(target uuid)
returns table (followers bigint, following bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select count(*) from public.user_follows
      where following_id = target and status = 'accepted'),
    (select count(*) from public.user_follows
      where follower_id = target and status = 'accepted');
$$;

revoke all on function public.follow_counts(uuid) from public;
revoke execute on function public.follow_counts(uuid) from anon;
grant execute on function public.follow_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Going public accepts every waiting request
--
-- The app only flips is_private; it never accepts requests itself. Each
-- accepted row fires the follow_accepted notification below, so everyone
-- who was waiting hears about it.
--
-- Public -> private needs nothing: existing followers stay accepted.
-- ---------------------------------------------------------------------------

create or replace function public.accept_requests_on_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_private and not new.is_private then
    update public.user_follows
       set status = 'accepted'
     where following_id = new.id
       and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists accept_requests_on_public on public.profiles;
create trigger accept_requests_on_public
  after update of is_private on public.profiles
  for each row execute function public.accept_requests_on_public();

-- ---------------------------------------------------------------------------
-- 7. Notification switches
--
-- Renamed rather than replaced, so everyone's saved choices carry over.
-- new_follower is new; it starts from the old friend_requests switch, the
-- closest thing to "someone wants to connect with me".
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'friend_accepted'
  ) then
    alter table public.notification_preferences
      rename column friend_accepted to follow_accepted;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'friend_requests'
  ) then
    alter table public.notification_preferences
      rename column friend_requests to follow_requests;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'new_follower'
  ) then
    alter table public.notification_preferences
      add column new_follower boolean not null default true;
    update public.notification_preferences set new_follower = follow_requests;
  end if;
end
$$;

-- notify() with the three follow types in place of friend_accepted.
-- Everything else is unchanged from 0026, restated because create or replace
-- needs the whole body. The friend_accepted branch has to go: its column was
-- just renamed, and plpgsql would fail on the stale reference at run time.
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

-- ---------------------------------------------------------------------------
-- 8. Follow notifications
-- ---------------------------------------------------------------------------

-- Follow -> unfollow -> follow must not stack "started following you" or
-- "requested to follow you" rows. follow_accepted is left out on purpose: a
-- second accept only happens after a real unfollow and a new request, which
-- is a genuine new event.
create unique index if not exists notifications_one_follow_per_pair
  on public.notifications (user_id, type, (payload ->> 'actor_id'))
  where type in ('new_follower', 'follow_requested');

create or replace function public.on_user_follow_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(
    new.following_id,
    new.follower_id,
    case when new.status = 'accepted' then 'new_follower' else 'follow_requested' end,
    '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists on_user_follow_insert on public.user_follows;
create trigger on_user_follow_insert
  after insert on public.user_follows
  for each row execute function public.on_user_follow_insert();

-- An accept tells the follower, and retires the request notification: the
-- request is no longer something waiting on the owner.
create or replace function public.on_user_follow_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    perform public.notify(
      new.follower_id,
      new.following_id,
      'follow_accepted',
      '{}'::jsonb
    );
    delete from public.notifications
     where user_id = new.following_id
       and type = 'follow_requested'
       and payload ->> 'actor_id' = new.follower_id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists on_user_follow_accept on public.user_follows;
create trigger on_user_follow_accept
  after update of status on public.user_follows
  for each row execute function public.on_user_follow_accept();

-- Unfollowing removes "started following you" only while it's unread, the
-- same rule as un-liking. A cancelled or declined request is removed
-- outright: it no longer describes anything that exists.
create or replace function public.on_user_follow_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
   where user_id = old.following_id
     and payload ->> 'actor_id' = old.follower_id::text
     and (
       type = 'follow_requested'
       or (type = 'new_follower' and read = false)
     );
  return old;
end;
$$;

drop trigger if exists on_user_follow_delete on public.user_follows;
create trigger on_user_follow_delete
  after delete on public.user_follows
  for each row execute function public.on_user_follow_delete();

-- ---------------------------------------------------------------------------
-- 9. Convert existing friendships
--
-- Triggers are off for the copy: it must keep the statuses worked out here
-- (the status trigger would recompute them) and must not send anyone a
-- burst of follow notifications for relationships that already existed.
--
--   accepted friendship         -> two accepted follows, one each way
--   pending, to a private user  -> pending follow request
--   pending, to a public user   -> accepted follow (the new model can't
--                                  hold a request to a public account)
--
-- created_at is carried over so lists keep their original order.
-- ---------------------------------------------------------------------------

alter table public.user_follows disable trigger user;

insert into public.user_follows (follower_id, following_id, status, created_at)
select f.user_id, f.friend_id, 'accepted', f.created_at
  from public.friendships f
 where f.status = 'accepted'
union all
select f.friend_id, f.user_id, 'accepted', f.created_at
  from public.friendships f
 where f.status = 'accepted'
union all
select
  f.user_id,
  f.friend_id,
  case when coalesce(p.is_private, false) then 'pending' else 'accepted' end,
  f.created_at
  from public.friendships f
  left join public.profiles p on p.id = f.friend_id
 where f.status = 'pending'
on conflict (follower_id, following_id) do nothing;

alter table public.user_follows enable trigger user;

-- Old "accepted your friend request" rows become "accepted your follow
-- request". The rows written by 0013's trigger carry friend_id rather than
-- actor_id; actor_id is added so they read like every other notification.
update public.notifications
   set type = 'follow_accepted',
       payload = payload || jsonb_build_object(
         'actor_id',
         coalesce(payload ->> 'actor_id', payload ->> 'friend_id')
       )
 where type = 'friend_accepted';

commit;
