-- Notification centre: friend-request activity and team announcements.
--
-- The notifications table already existed with the right columns. What it
-- needed was policies, and specifically NO insert policy: rows are written
-- only by the trigger below (security definer) or by the service role, so
-- nobody can post a fake notification into someone else's bell.
--
-- Pending friend requests are deliberately NOT stored here. The panel reads
-- them straight from friendships, so a request that is cancelled, accepted or
-- declined anywhere else disappears from the bell with nothing to keep in
-- sync. Only the accept generates a durable row, for the person who asked.

alter table public.notifications enable row level security;

drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users mark their own notifications read" on public.notifications;
create policy "Users mark their own notifications read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own notifications" on public.notifications;
create policy "Users delete their own notifications"
  on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No insert policy on purpose. See the note above.
drop policy if exists "Users can insert notifications" on public.notifications;

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);

-- ---------------------------------------------------------------------------
-- Accepting a request notifies whoever sent it.
--
-- Payload carries ids only, never names: the UI resolves the current display
-- name and avatar at render time, so renaming an account doesn't leave stale
-- text sitting in someone's bell.
-- ---------------------------------------------------------------------------
create or replace function public.notify_friend_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and coalesce(old.status, '') <> 'accepted' then
    insert into public.notifications (user_id, type, payload)
    values (
      new.user_id,                                   -- the original requester
      'friend_accepted',
      jsonb_build_object('friend_id', new.friend_id) -- who accepted
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_friendship_accepted on public.friendships;
create trigger on_friendship_accepted
  after update on public.friendships
  for each row execute function public.notify_friend_accepted();

-- ---------------------------------------------------------------------------
-- Announcements
--
-- There is no admin UI by design. The team posts one from the Supabase SQL
-- editor, which runs as the service role:
--
--   insert into public.announcements (title, body, link)
--   values (
--     'Reviews are live',
--     'You can now rate and review any song in the catalogue.',
--     '/explore'          -- optional; omit or null for no link
--   );
--
-- Delete one the same way: delete from public.announcements where id = '…';
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  link       text,
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "Announcements are readable by everyone" on public.announcements;
create policy "Announcements are readable by everyone"
  on public.announcements for select to authenticated
  using (true);

-- No insert/update/delete policies: writes are service-role only.

-- ---------------------------------------------------------------------------
-- Per-user read state, rather than copying every announcement into every
-- user's notifications. One row per (user, announcement) or none.
-- ---------------------------------------------------------------------------
create table if not exists public.announcement_reads (
  user_id         uuid not null references public.profiles(id)      on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

alter table public.announcement_reads enable row level security;

drop policy if exists "Users read their own announcement reads" on public.announcement_reads;
create policy "Users read their own announcement reads"
  on public.announcement_reads for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users mark announcements read for themselves" on public.announcement_reads;
create policy "Users mark announcements read for themselves"
  on public.announcement_reads for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users clear their own announcement reads" on public.announcement_reads;
create policy "Users clear their own announcement reads"
  on public.announcement_reads for delete to authenticated
  using ((select auth.uid()) = user_id);
