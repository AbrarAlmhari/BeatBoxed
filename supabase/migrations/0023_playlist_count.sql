-- The playlist count for a profile header.
--
-- Needed for the same reason review_count() and following_count() exist
-- (0022): after account privacy, a direct count over playlists returns 0 for
-- a non-friend looking at a private profile, because RLS hides the rows. A
-- private profile is still supposed to show its numbers — only the rows
-- behind them are hidden — so the count goes through a security definer
-- function that returns the figure and never the playlists.

create or replace function public.playlist_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint from public.playlists where user_id = target;
$$;

revoke all on function public.playlist_count(uuid) from public;
revoke execute on function public.playlist_count(uuid) from anon;

create index if not exists playlists_user_idx on public.playlists (user_id);
