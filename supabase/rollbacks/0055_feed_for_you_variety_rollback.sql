-- Undoes 0055: removes feed_for_you_mixed. feed_for_you (0046) was never
-- changed, so the app goes back to it in the same step. No data is touched.
begin;

drop function if exists public.feed_for_you_mixed(int, timestamptz, int, uuid[], double precision, uuid, int);

commit;
