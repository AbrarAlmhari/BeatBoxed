-- Undoes migrations/0029_beatie.sql. Kept out of migrations/ on purpose:
-- replaying that folder in order would otherwise undo 0029 right after it.
-- Run it by hand, only if 0029 has to be backed out, together with removing
-- the beatie Edge Function (it reads and writes these tables).
--
-- Lost: every cached Beatie answer and the usage counts. Nothing else
-- depends on them; Beatie would simply call Gemini again on the next request.
--
-- All or nothing, like 0029.
begin;

drop function if exists public.beatie_take_quota(uuid, int, int);

drop table if exists public.beatie_global_usage;
drop table if exists public.beatie_usage;
drop table if exists public.beatie_cache;

commit;
