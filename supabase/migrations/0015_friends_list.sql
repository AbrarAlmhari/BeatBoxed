-- Public friend lists, with a visibility switch Settings will flip later.
--
-- friendships stays private: only the two people in a row can select it. This
-- function is the one way to read someone else's friends, and it returns
-- accepted friends' public profile fields and nothing else — never a pending
-- request, never the friendship row itself.

alter table public.profiles
  add column if not exists friends_list_visible boolean not null default true;

create or replace function public.get_friends(target uuid)
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
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_id = target then f.friend_id else f.user_id end
  where f.status = 'accepted'
    and (f.user_id = target or f.friend_id = target)
    -- Hidden lists return nothing to anyone but the owner. Enforced here as
    -- well as in the UI, since the UI reads a flag it could simply ignore.
    and (
      coalesce(
        (select pr.friends_list_visible from public.profiles pr where pr.id = target),
        true
      )
      or (select auth.uid()) = target
    )
  order by lower(coalesce(p.display_name, p.username, ''));
$$;

-- Supabase grants execute on new public-schema functions to anon by default,
-- so revoking from PUBLIC alone isn't enough.
revoke all on function public.get_friends(uuid) from public;
revoke execute on function public.get_friends(uuid) from anon;
grant execute on function public.get_friends(uuid) to authenticated;
