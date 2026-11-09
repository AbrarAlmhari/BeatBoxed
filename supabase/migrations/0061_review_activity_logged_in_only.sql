-- Review comments, likes and mentions can only be read when logged in. This
-- only changes who the policies apply to, so the private-review rules stay as
-- they are. Rollback: supabase/rollbacks/0061_*.
begin;
alter policy "Comments are visible with their review" on public.review_comments to authenticated;
alter policy "Review likes are visible with their review" on public.review_likes to authenticated;
alter policy "Mentions are visible with their review" on public.comment_mentions to authenticated;
alter policy "Comment likes are visible with their review" on public.comment_likes to authenticated;
revoke execute on function public.review_thread(uuid, text) from public, anon;
revoke execute on function public.review_previews(uuid[]) from public, anon;
commit;
