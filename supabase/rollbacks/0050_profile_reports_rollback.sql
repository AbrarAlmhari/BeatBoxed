-- Undoes migrations/0050_profile_reports.sql. Run by hand only, together with
-- reverting the app's Report option (it writes to this table).
--
-- Lost: every report filed so far. Nothing else is touched.
begin;

drop table if exists public.profile_reports;

commit;
