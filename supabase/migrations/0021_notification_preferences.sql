-- Per-user notification switches, enforced in notify() so a turned-off type
-- is never written and no trigger has to know about preferences.
--
-- A table rather than a jsonb column on profiles: notify() runs inside every
-- social trigger, so the check wants to be one indexed primary-key lookup
-- rather than jsonb parsing per notification. It also matches how
-- announcement_reads already keeps per-user state beside profiles instead of
-- widening it.
--
-- Absence means "on". Nobody gets a row until they change something, so
-- existing users keep today's behaviour with no backfill.

create table if not exists public.notification_preferences (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  -- Written by notify(), which is keyed on notifications.type.
  review_liked     boolean not null default true,
  review_commented boolean not null default true,
  thread_reply     boolean not null default true,
  friend_accepted  boolean not null default true,
  -- Not written by notify(): pending requests are read live from friendships
  -- and announcements from their own table. These two only gate what the
  -- bell counts and what the notifications page lists.
  friend_requests  boolean not null default true,
  announcements    boolean not null default true,
  updated_at       timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

-- Entirely private: your own switches, nobody else's business.
drop policy if exists "Users read their own notification preferences"
  on public.notification_preferences;
create policy "Users read their own notification preferences"
  on public.notification_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own notification preferences"
  on public.notification_preferences;
create policy "Users create their own notification preferences"
  on public.notification_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own notification preferences"
  on public.notification_preferences;
create policy "Users update their own notification preferences"
  on public.notification_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own notification preferences"
  on public.notification_preferences;
create policy "Users delete their own notification preferences"
  on public.notification_preferences for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.touch_notification_preferences()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_notification_preferences();

-- ---------------------------------------------------------------------------
-- notify(), now preference-aware
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
  -- Nobody needs telling about their own action.
  if recipient_id is null or actor_id is null or recipient_id = actor_id then
    return;
  end if;

  -- No row means every type is on, so a user who has never opened Settings
  -- behaves exactly as before.
  select case notif_type
           when 'review_liked'     then p.review_liked
           when 'review_commented' then p.review_commented
           when 'thread_reply'     then p.thread_reply
           when 'friend_accepted'  then p.friend_accepted
           -- An unknown type is delivered rather than silently dropped: a
           -- new notification type should be noisy until someone adds a
           -- switch for it, not invisible.
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
  -- Covers like -> unlike -> like: the partial index keeps one row.
  on conflict do nothing;
end;
$$;

-- SECURITY FIX, not a refactor.
--
-- 0014 revoked this from `public`, which is not enough: Supabase grants
-- execute on new public-schema functions to anon and authenticated
-- explicitly, and a role-level grant outranks the absence of a public one.
-- Verified against the live database before writing this — a signed-in user
-- could POST /rest/v1/rpc/notify and forge any notification to anyone,
-- including types they could never trigger legitimately:
--
--   POST /rest/v1/rpc/notify -> 204, row lands on the victim
--
-- Inserting into notifications directly was already blocked (no insert
-- policy); only this helper was exposed. Nothing in the app calls it — the
-- triggers do, and they are security definer, so they run as the owner and
-- keep execute regardless of what is revoked here.
revoke all on function public.notify(uuid, uuid, text, jsonb) from public;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from anon;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from authenticated;
