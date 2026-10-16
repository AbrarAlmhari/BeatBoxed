-- Undoes migrations/0044_review_visible_to_followers.sql: puts back 0042's
-- review_visible_to(), which treats approved followers of a private account
-- as unable to see its reviews whenever someone else is asking (mentions,
-- suggestions and reply notifications on private reviews). Nothing is lost.
begin;

create or replace function public.review_visible_to(target_review uuid, viewer_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.reviews r
     where r.id = target_review
       and (
         public.can_view_profile(viewer_id, r.user_id)
         or (
           viewer_id is null
           and not coalesce(
             (select p.is_private from public.profiles p where p.id = r.user_id),
             false
           )
         )
       )
  );
$$;

revoke all on function public.review_visible_to(uuid, uuid) from public;
revoke execute on function public.review_visible_to(uuid, uuid) from anon;
revoke execute on function public.review_visible_to(uuid, uuid) from authenticated;

commit;
