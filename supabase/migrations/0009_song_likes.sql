-- Liking a song, which is deliberately not the same as reviewing it: you can
-- like something without writing a review, or review something without liking
-- it. Same shape as follows — binary, so the composite key is the whole story
-- and there is no update path.

create table if not exists public.song_likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  song_id    uuid not null references public.songs(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create index if not exists song_likes_user_recent_idx
  on public.song_likes (user_id, created_at desc);
create index if not exists song_likes_song_id_idx
  on public.song_likes (song_id);

alter table public.song_likes enable row level security;

drop policy if exists "Song likes are viewable by everyone" on public.song_likes;
create policy "Song likes are viewable by everyone"
  on public.song_likes for select using (true);

drop policy if exists "Users can like as themselves" on public.song_likes;
create policy "Users can like as themselves"
  on public.song_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own song like" on public.song_likes;
create policy "Users can remove their own song like"
  on public.song_likes for delete to authenticated
  using ((select auth.uid()) = user_id);
