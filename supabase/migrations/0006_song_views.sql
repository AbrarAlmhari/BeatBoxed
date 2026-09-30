-- What each user has actually opened, used to seed Home's For You rail.
--
-- A view is a stronger signal than a search string: it references a real song
-- row, and it means the user went past the result list into the detail page.
-- Searching something and never clicking it says much less.
--
-- One row per (user, song) rather than one per visit — revisiting updates the
-- timestamp instead of growing the table without bound. Recency and presence
-- are all the recommendation needs; a visit counter isn't worth the write
-- amplification.

create table if not exists public.song_views (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  song_id   uuid not null references public.songs(id)    on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create index if not exists song_views_user_recent_idx
  on public.song_views (user_id, viewed_at desc);

alter table public.song_views enable row level security;

-- Unlike reviews and likes, browsing history is private. Every policy is
-- scoped to the owner, including select — nobody else can read what you've
-- looked at.
drop policy if exists "Users can read their own song views" on public.song_views;
create policy "Users can read their own song views"
  on public.song_views for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can record their own song views" on public.song_views;
create policy "Users can record their own song views"
  on public.song_views for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can refresh their own song views" on public.song_views;
create policy "Users can refresh their own song views"
  on public.song_views for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own song views" on public.song_views;
create policy "Users can delete their own song views"
  on public.song_views for delete
  to authenticated
  using ((select auth.uid()) = user_id);
