-- Review titles, likes, and comments.
--
-- user_id references public.profiles to match the existing reviews table,
-- which is what lets PostgREST embed author details in one query.

-- ---------------------------------------------------------------------------
-- 1. Optional review title
-- ---------------------------------------------------------------------------
alter table public.reviews add column if not exists title text;

-- ---------------------------------------------------------------------------
-- 2. Likes — binary, so the composite PK is the whole story: one row per
--    (review, user) or none. No update path is needed or wanted.
-- ---------------------------------------------------------------------------
create table if not exists public.review_likes (
  review_id  uuid not null references public.reviews(id)  on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create index if not exists review_likes_review_id_idx on public.review_likes (review_id);
create index if not exists review_likes_user_id_idx   on public.review_likes (user_id);

alter table public.review_likes enable row level security;

drop policy if exists "Review likes are viewable by everyone" on public.review_likes;
create policy "Review likes are viewable by everyone"
  on public.review_likes for select using (true);

drop policy if exists "Users can like as themselves" on public.review_likes;
create policy "Users can like as themselves"
  on public.review_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own like" on public.review_likes;
create policy "Users can remove their own like"
  on public.review_likes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Comments
-- ---------------------------------------------------------------------------
create table if not exists public.review_comments (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.reviews(id)  on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited     boolean not null default false
);

create index if not exists review_comments_review_id_idx
  on public.review_comments (review_id, created_at);

alter table public.review_comments enable row level security;

drop policy if exists "Review comments are viewable by everyone" on public.review_comments;
create policy "Review comments are viewable by everyone"
  on public.review_comments for select using (true);

drop policy if exists "Users can comment as themselves" on public.review_comments;
create policy "Users can comment as themselves"
  on public.review_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can edit their own comments" on public.review_comments;
create policy "Users can edit their own comments"
  on public.review_comments for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own comments" on public.review_comments;
create policy "Users can delete their own comments"
  on public.review_comments for delete to authenticated
  using ((select auth.uid()) = user_id);
