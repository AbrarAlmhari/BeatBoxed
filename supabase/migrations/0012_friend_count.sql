-- Friend count for any profile, without exposing the friend list.
--
-- friendships RLS only lets the two people in a row read it, which is correct
-- — but it also means a normal count query returns 0 for anyone else's
-- profile. This function runs as its owner to get past that, and returns a
-- single integer: no ids, no rows, nothing that would leak who someone's
-- friends are.

create or replace function public.friend_count(target uuid)
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::int
  from public.friendships
  where status = 'accepted'
    and (user_id = target or friend_id = target);
$$;

revoke all on function public.friend_count(uuid) from public;
-- Supabase grants execute on new public-schema functions to anon by default,
-- so revoking from PUBLIC alone isn't enough.
revoke execute on function public.friend_count(uuid) from anon;
grant execute on function public.friend_count(uuid) to authenticated;
