-- Undoes 0061: review comments, likes and mentions are open to logged-out visitors again.
begin;
alter policy "Comments are visible with their review" on public.review_comments to anon, authenticated;
alter policy "Review likes are visible with their review" on public.review_likes to anon, authenticated;
alter policy "Mentions are visible with their review" on public.comment_mentions to anon, authenticated;
alter policy "Comment likes are visible with their review" on public.comment_likes to anon, authenticated;
grant execute on function public.review_thread(uuid, text) to anon;
grant execute on function public.review_previews(uuid[]) to anon;
commit;
