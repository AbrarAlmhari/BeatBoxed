-- Undoes migrations/0028_review_feed.sql. Kept out of migrations/ on purpose:
-- replaying that folder in order would otherwise undo 0028 right after it.
-- Run it by hand, only if 0028 has to be backed out, together with
-- reverting the frontend (Home reads these functions).
--
-- Lost: every row in review_reports. Nothing else 0028 added holds data.
--
-- All or nothing, like 0028.
begin;

drop table if exists public.review_reports;

drop function if exists public.suggested_reviewers(int, int);
drop function if exists public.feed_for_you(int, timestamptz, double precision, uuid, int);
drop function if exists public.feed_following(int, timestamptz, uuid, int);

drop index if exists public.reviews_created_at_id_idx;

commit;
