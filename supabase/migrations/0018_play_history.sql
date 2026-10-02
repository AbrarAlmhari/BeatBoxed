-- What each user has actually listened to, used to fill Home's Continue
-- Listening rail and to resume a preview where they left off.
--
-- Deliberately separate from song_views. Opening a song's page is curiosity;
-- listening to it is a different signal, and conflating the two would put
-- every song you glanced at into a rail that claims you were playing it.
--
-- One row per (user, song), like song_views: replaying a song moves its
-- timestamp instead of growing the table. The rail only needs recency and
-- the resume point, so a per-play log would be write amplification for data
-- nothing reads.
--
-- position_seconds is where to resume. Previews are 30 seconds, so this is
-- small, but it is stored as real rather than int to survive a pause between
-- ticks. The client decides what counts as "nearly finished" and restarts
-- from zero in that case; the column just records where playback stopped.

create table if not exists public.play_history (
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  song_id          uuid        not null references public.songs(id)    on delete cascade,
  played_at        timestamptz not null default now(),
  position_seconds real        not null default 0 check (position_seconds >= 0),
  primary key (user_id, song_id)
);

create index if not exists play_history_user_recent_idx
  on public.play_history (user_id, played_at desc);

alter table public.play_history enable row level security;

-- Private, exactly like song_views: listening history is nobody else's
-- business, so even select is scoped to the owner.
drop policy if exists "Users can read their own play history" on public.play_history;
create policy "Users can read their own play history"
  on public.play_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can record their own plays" on public.play_history;
create policy "Users can record their own plays"
  on public.play_history for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own plays" on public.play_history;
create policy "Users can update their own plays"
  on public.play_history for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own plays" on public.play_history;
create policy "Users can delete their own plays"
  on public.play_history for delete
  to authenticated
  using ((select auth.uid()) = user_id);
