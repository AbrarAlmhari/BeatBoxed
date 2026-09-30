-- Reviews: allow authors to delete their own review.
--
-- 0002 gave reviews select/insert/update policies but no delete. With RLS on,
-- a DELETE without a matching policy isn't an error — it just affects zero
-- rows, so the UI would report success while the review stayed put.
--
-- Run in the Supabase SQL editor.

drop policy if exists "Users can delete their own reviews" on public.reviews;
create policy "Users can delete their own reviews"
  on public.reviews for delete
  to authenticated
  using ((select auth.uid()) = user_id);
