-- Undoes migrations/0027_user_follows.sql. Kept out of migrations/ on purpose:
-- replaying that folder in order would otherwise undo 0027 right after it.
-- Run it by hand, only if 0027 has to be backed out.
--
-- Run it together with reverting the frontend to the friends version. The
-- 0027 app reads user_follows and the follow_* setting columns, so it breaks
-- the moment this runs; the old app reads friendships and friend_*, which is
-- what this restores.
--
-- What is lost: friendships was never touched by 0027, so it comes back
-- exactly as it was before. Anything people did through follows while 0027
-- was live -- new follows, accepted requests, unfollows -- has no friendships
-- equivalent and is dropped with user_follows. Notifications of the two
-- follow-only types (new_follower, follow_requested) are deleted, because the
-- old app has no way to show them.
--
-- All or nothing, like 0027.
begin;

-- ---------------------------------------------------------------------------
-- 1. Privacy back on friendships (exactly as 0022 defined it)
--
-- First, so can_view_profile never points at a function that's gone.
-- ---------------------------------------------------------------------------

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
      or exists (
        select 1
          from public.friendships f
         where f.status = 'accepted'
           and (
             (f.user_id = viewer_id and f.friend_id = owner_id)
             or (f.user_id = owner_id and f.friend_id = viewer_id)
           )
      )
    );
$$;

revoke all on function public.can_view_profile(uuid, uuid) from public;
revoke execute on function public.can_view_profile(uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. The auto-accept trigger on profiles
-- ---------------------------------------------------------------------------

drop trigger if exists accept_requests_on_public on public.profiles;
drop function if exists public.accept_requests_on_public();

-- ---------------------------------------------------------------------------
-- 3. user_follows, its triggers and policies (dropped with the table), and
--    every function 0027 added
-- ---------------------------------------------------------------------------

drop table if exists public.user_follows;

drop function if exists public.user_follows_set_status();
drop function if exists public.on_user_follow_insert();
drop function if exists public.on_user_follow_accept();
drop function if exists public.on_user_follow_delete();
drop function if exists public.viewer_follows(uuid, uuid);
drop function if exists public.get_followers(uuid);
drop function if exists public.get_following(uuid);
drop function if exists public.follow_counts(uuid);

-- ---------------------------------------------------------------------------
-- 4. Notifications
-- ---------------------------------------------------------------------------

drop index if exists public.notifications_one_follow_per_pair;

-- Follow-only types have no friends equivalent and no renderer in the old app.
delete from public.notifications
 where type in ('new_follower', 'follow_requested');

-- follow_accepted back to friend_accepted. The rows 0027 retyped had
-- actor_id added alongside their original friend_id; take it back off so
-- they're byte-for-byte what they were. Rows created while 0027 was live
-- only ever had actor_id, which the old renderer reads first, so they keep it.
update public.notifications
   set type = 'friend_accepted',
       payload = case
         when payload ? 'friend_id'
          and payload ->> 'actor_id' = payload ->> 'friend_id'
           then payload - 'actor_id'
         else payload
       end
 where type = 'follow_accepted';

-- ---------------------------------------------------------------------------
-- 5. Notification switches back to their old names
--
-- Renames rather than recreates, so anything changed while 0027 was live is
-- kept. new_follower had no old equivalent and is dropped.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'follow_accepted'
  ) then
    alter table public.notification_preferences
      rename column follow_accepted to friend_accepted;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'follow_requests'
  ) then
    alter table public.notification_preferences
      rename column follow_requests to friend_requests;
  end if;
end
$$;

alter table public.notification_preferences drop column if exists new_follower;

-- notify() exactly as 0026 defined it. Has to come after the renames: it
-- reads p.friend_accepted, which only exists again now.
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
           when 'friend_accepted'  then p.friend_accepted
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
