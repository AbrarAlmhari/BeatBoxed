-- Playlists were created back in 0001-era setup and already carry the columns
-- docs/data-model.md describes, plus working owner-only RLS. This migration
-- only closes the gaps found by probing the live tables:
--
--   1. playlists has no updated_at.
--   2. select is open to anon; playlists show on profiles, which are a
--      signed-in surface, so reads belong to authenticated.
--
-- Deliberately NOT added: a unique constraint on (playlist_id, song_id). It
-- already exists — that pair is the primary key of playlist_songs, and a
-- second insert of the same song is rejected with 23505. A separate unique
-- index would duplicate the PK's index for nothing.
--
-- Also already correct, verified against the live database rather than
-- assumed: insert/update/delete on both tables are owner-only (a non-owner's
-- update or delete matches zero rows, and inserting a row owned by someone
-- else fails with 42501), playlist_songs enforces ownership through the
-- parent playlist, and deleting a playlist cascades to its songs.

-- 1. updated_at ------------------------------------------------------------

alter table public.playlists
  add column if not exists updated_at timestamptz not null default now();

-- Maintained by the database rather than the client, so a forgotten field in
-- one call can't leave the timestamp lying.
create or replace function public.touch_playlist_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists playlists_touch_updated_at on public.playlists;
create trigger playlists_touch_updated_at
  before update on public.playlists
  for each row execute function public.touch_playlist_updated_at();

-- Adding, removing or reordering songs changes the playlist as a whole, so
-- the parent's timestamp should move too. Without this, "recently updated"
-- would only ever reflect title and description edits.
create or replace function public.touch_playlist_from_songs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.playlists
     set updated_at = now()
   where id = coalesce(new.playlist_id, old.playlist_id);
  return coalesce(new, old);
end;
$$;

revoke execute on function public.touch_playlist_from_songs() from public;
revoke execute on function public.touch_playlist_from_songs() from anon;

drop trigger if exists playlist_songs_touch_parent on public.playlist_songs;
create trigger playlist_songs_touch_parent
  after insert or update or delete on public.playlist_songs
  for each row execute function public.touch_playlist_from_songs();

-- 2. Reads are for signed-in users ------------------------------------------

-- Dropped by lookup rather than by name: these policies were created before
-- this migration series and their names aren't recorded anywhere here.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('playlists', 'playlist_songs')
       and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

create policy "Signed-in users can read playlists"
  on public.playlists for select
  to authenticated
  using (true);

create policy "Signed-in users can read playlist songs"
  on public.playlist_songs for select
  to authenticated
  using (true);

-- 3. Indexes the new screens read through ------------------------------------

-- The detail page always reads a playlist's songs in position order.
create index if not exists playlist_songs_order_idx
  on public.playlist_songs (playlist_id, position);

-- Library and Profile both list one user's playlists, newest first.
create index if not exists playlists_user_recent_idx
  on public.playlists (user_id, created_at desc);
