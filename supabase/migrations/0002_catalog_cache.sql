-- Catalog cache support. Run in the Supabase SQL editor before deploying the
-- Edge Functions.
--
-- spotify-search upserts with onConflict: 'spotify_id', which Postgres can only
-- resolve against a unique constraint. Without these indexes every upsert fails
-- with "no unique or exclusion constraint matching the ON CONFLICT spec".

-- ---------------------------------------------------------------------------
-- 1. Uniqueness on the Spotify key
-- ---------------------------------------------------------------------------
create unique index if not exists artists_spotify_id_key
  on public.artists (spotify_id) where spotify_id is not null;

create unique index if not exists albums_spotify_id_key
  on public.albums (spotify_id) where spotify_id is not null;

create unique index if not exists songs_spotify_id_key
  on public.songs (spotify_id) where spotify_id is not null;

-- ---------------------------------------------------------------------------
-- 1b. When each row entered our cache
--
-- docs/data-model.md gives the catalog tables no timestamp, so there is no way
-- to ask "what did we cache most recently" — which Home's Trending rail needs
-- as its fallback before any reviews exist. Additive and nullable, so it can't
-- break another slice's queries.
-- ---------------------------------------------------------------------------
alter table public.artists add column if not exists cached_at timestamptz default now();
alter table public.albums  add column if not exists cached_at timestamptz default now();
alter table public.songs   add column if not exists cached_at timestamptz default now();

create index if not exists songs_cached_at_idx on public.songs (cached_at desc);

-- ---------------------------------------------------------------------------
-- 2. Lookup indexes the Home and Explore queries lean on
-- ---------------------------------------------------------------------------
create index if not exists songs_artist_id_idx on public.songs (artist_id);
create index if not exists songs_album_id_idx on public.songs (album_id);
create index if not exists songs_genre_idx on public.songs (genre);
create index if not exists reviews_song_id_idx on public.reviews (song_id);
create index if not exists follows_user_id_idx on public.follows (user_id);

-- ---------------------------------------------------------------------------
-- 3. RLS: catalog is world-readable, writable only by the service role
--    (spotify-search). Client-side writes stay blocked.
-- ---------------------------------------------------------------------------
alter table public.artists enable row level security;
alter table public.albums  enable row level security;
alter table public.songs   enable row level security;

drop policy if exists "Catalog artists are viewable by everyone" on public.artists;
create policy "Catalog artists are viewable by everyone"
  on public.artists for select using (true);

drop policy if exists "Catalog albums are viewable by everyone" on public.albums;
create policy "Catalog albums are viewable by everyone"
  on public.albums for select using (true);

drop policy if exists "Catalog songs are viewable by everyone" on public.songs;
create policy "Catalog songs are viewable by everyone"
  on public.songs for select using (true);

-- Reviews drive Trending, so they must be readable; writes stay owner-only.
alter table public.reviews enable row level security;

drop policy if exists "Reviews are viewable by everyone" on public.reviews;
create policy "Reviews are viewable by everyone"
  on public.reviews for select using (true);

drop policy if exists "Users can write their own reviews" on public.reviews;
create policy "Users can write their own reviews"
  on public.reviews for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own reviews" on public.reviews;
create policy "Users can update their own reviews"
  on public.reviews for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Follows drive the For You rail.
alter table public.follows enable row level security;

drop policy if exists "Follows are viewable by everyone" on public.follows;
create policy "Follows are viewable by everyone"
  on public.follows for select using (true);

drop policy if exists "Users manage their own follows" on public.follows;
create policy "Users manage their own follows"
  on public.follows for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
