-- Undoes migrations/0042_comment_privacy.sql. Run by hand only, after
-- 0043's rollback (0043 uses can_view_review() and review_visible_to()).
--
-- Puts back 0004's policies exactly, which reopens the gap 0042 closed:
-- comments and review likes on private accounts become readable by anyone
-- again. Nothing is lost; no rows were touched.
begin;

drop policy if exists "Comments are visible with their review" on public.review_comments;
create policy "Review comments are viewable by everyone"
  on public.review_comments for select using (true);

drop policy if exists "Users can comment as themselves" on public.review_comments;
create policy "Users can comment as themselves"
  on public.review_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Review likes are visible with their review" on public.review_likes;
create policy "Review likes are viewable by everyone"
  on public.review_likes for select using (true);

drop policy if exists "Users can like as themselves" on public.review_likes;
create policy "Users can like as themselves"
  on public.review_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop function if exists public.can_view_review(uuid);
drop function if exists public.review_visible_to(uuid, uuid);

commit;
