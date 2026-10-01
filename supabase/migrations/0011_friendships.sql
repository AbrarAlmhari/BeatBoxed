-- Friend requests.
--
-- The table already existed with user_id / friend_id / status but no
-- created_at, no uniqueness, no self-request guard, and — importantly — it was
-- readable by anyone. docs/data-model.md calls this a social graph; unlike
-- follows it should be private to the two people involved.

alter table public.friendships
  add column if not exists created_at timestamptz not null default now();

-- One row per ordered pair, so a repeated tap can't stack duplicate requests.
create unique index if not exists friendships_pair_key
  on public.friendships (user_id, friend_id);

create index if not exists friendships_friend_id_idx
  on public.friendships (friend_id, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'friendships_no_self'
  ) then
    alter table public.friendships
      add constraint friendships_no_self check (user_id <> friend_id);
  end if;
end $$;

alter table public.friendships enable row level security;

-- Private: only the requester and the recipient can see the row.
drop policy if exists "Friendships are viewable by everyone" on public.friendships;
drop policy if exists "Friendships are visible to both parties" on public.friendships;
create policy "Friendships are visible to both parties"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_id, friend_id));

drop policy if exists "Users can request as themselves" on public.friendships;
create policy "Users can request as themselves"
  on public.friendships for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Only the recipient can accept.
drop policy if exists "Recipients can accept a request" on public.friendships;
create policy "Recipients can accept a request"
  on public.friendships for update to authenticated
  using ((select auth.uid()) = friend_id)
  with check ((select auth.uid()) = friend_id);

-- Either side may remove the row: cancel, decline, or unfriend.
drop policy if exists "Either party can remove the friendship" on public.friendships;
create policy "Either party can remove the friendship"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_id, friend_id));

-- ---------------------------------------------------------------------------
-- Requesting someone who already requested you is an accept, not a duplicate.
-- Doing this in one statement server-side avoids the race a client-side
-- check-then-insert would have.
-- ---------------------------------------------------------------------------
create or replace function public.request_friendship(target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if me = target then
    raise exception 'cannot send a friend request to yourself';
  end if;

  update public.friendships
     set status = 'accepted'
   where user_id = target and friend_id = me and status = 'pending';
  if found then
    return 'accepted';
  end if;

  insert into public.friendships (user_id, friend_id, status)
  values (me, target, 'pending')
  on conflict (user_id, friend_id) do nothing;

  return 'pending';
end;
$$;

revoke all on function public.request_friendship(uuid) from public;
grant execute on function public.request_friendship(uuid) to authenticated;
