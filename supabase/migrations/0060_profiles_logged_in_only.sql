-- Profiles can only be read when logged in, and mention_people, which turns a
-- user id into a username, can no longer be called logged out. No signed-out
-- screen reads either. Rollback: supabase/rollbacks/0060_*.
begin;
alter policy "Profiles are viewable by everyone" on public.profiles to authenticated;
alter policy "Profiles are viewable by everyone" on public.profiles rename to "Profiles are viewable by logged-in users";
revoke execute on function public.mention_people(text) from public, anon;
commit;
