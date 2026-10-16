-- Comments and review likes follow the review's privacy.
--
-- 0004 made both readable by everyone, signed in or not, and nothing since
-- changed that, while 0022 put reviews themselves behind can_view_profile().
-- So the comments and likes on a private account's reviews were readable by
-- anyone with the public API key. Checked against the live database before
-- writing this: a logged-out request returned comments while the same
-- request for reviews returned none.
--
-- The rule now: you can read a review's comments and likes when you could
-- see the review. Signed in, that's can_view_profile() on its author, the
-- same as the review. Logged out, it's any review by a public account, so
-- comments and likes on public profiles stay readable without an account.
-- Writing a comment or a like also needs to be able to see the review.
--
-- Changes existing policies only. No rows are touched.

-- ---------------------------------------------------------------------------
-- 1. Who can see a review
-- ---------------------------------------------------------------------------

-- The one place the rule lives, with the viewer passed in, for triggers
-- that ask on someone else's behalf (who may be notified, who may be
-- mentioned). Internal: nobody can call it over the API, so it can't be
-- used to probe who follows a private account.
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
         -- Logged out: public accounts only.
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

-- The same question for whoever is asking, which is what the policies use.
-- Takes no viewer, so it only ever answers for the caller.
create or replace function public.can_view_review(target_review uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.review_visible_to(target_review, auth.uid());
$$;

revoke all on function public.can_view_review(uuid) from public;
grant execute on function public.can_view_review(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. review_comments
-- ---------------------------------------------------------------------------

drop policy if exists "Review comments are viewable by everyone" on public.review_comments;
drop policy if exists "Comments are visible with their review" on public.review_comments;
create policy "Comments are visible with their review"
  on public.review_comments for select
  to anon, authenticated
  using (public.can_view_review(review_id));

drop policy if exists "Users can comment as themselves" on public.review_comments;
create policy "Users can comment as themselves"
  on public.review_comments for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.can_view_review(review_id));

-- ---------------------------------------------------------------------------
-- 3. review_likes
-- ---------------------------------------------------------------------------

drop policy if exists "Review likes are viewable by everyone" on public.review_likes;
drop policy if exists "Review likes are visible with their review" on public.review_likes;
create policy "Review likes are visible with their review"
  on public.review_likes for select
  to anon, authenticated
  using (public.can_view_review(review_id));

drop policy if exists "Users can like as themselves" on public.review_likes;
create policy "Users can like as themselves"
  on public.review_likes for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.can_view_review(review_id));
