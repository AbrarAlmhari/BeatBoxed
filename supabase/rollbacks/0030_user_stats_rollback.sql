-- Undoes migrations/0030_user_stats.sql. Kept out of migrations/ on purpose:
-- replaying that folder in order would otherwise undo 0030 right after it.
-- Run it by hand, only if 0030 has to be backed out, together with
-- reverting the frontend (the profile's Stats tab calls this function).
--
-- Lost: nothing. 0030 only added a function and an index.
begin;

drop function if exists public.get_user_stats(uuid, text);
drop index if exists public.reviews_user_created_idx;

commit;
