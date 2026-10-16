-- Fixes 0042's review_visible_to() for approved followers of a private
-- account.
--
-- It asked can_view_profile(viewer, author), which asks viewer_follows().
-- viewer_follows() answers false whenever the viewer isn't the signed-in
-- caller (0027: so it can't be used over the API to find out who follows
-- whom). That's right for the API, but review_visible_to() asks on someone
-- else's behalf from inside the comment triggers, where the caller is the
-- person commenting. So on a private account's review an approved follower
-- was treated as unable to see it: they couldn't be mentioned or suggested,
-- and weren't notified about replies. Found by the live checks right after
-- 0043; public reviews and logged-out reads were unaffected.
--
-- Same rule as can_view_profile(), written out here without the caller
-- check. review_visible_to() stays internal (no API access), which is what
-- keeps that safe.

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
      left join public.profiles p on p.id = r.user_id
     where r.id = target_review
       and (
         -- Public account: anyone, signed in or not.
         not coalesce(p.is_private, false)
         -- Private: the author, and their approved followers.
         or (viewer_id is not null and viewer_id = r.user_id)
         or (
           viewer_id is not null
           and exists (
             select 1
               from public.user_follows uf
              where uf.follower_id = viewer_id
                and uf.following_id = r.user_id
                and uf.status = 'accepted'
           )
         )
       )
  );
$$;

revoke all on function public.review_visible_to(uuid, uuid) from public;
revoke execute on function public.review_visible_to(uuid, uuid) from anon;
revoke execute on function public.review_visible_to(uuid, uuid) from authenticated;
