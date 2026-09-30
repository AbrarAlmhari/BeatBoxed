-- Popularity for Home's Trending rail.
--
-- Spotify withholds `popularity` from this app (absent on search, on
-- /v1/tracks/{id}, and on album tracks; the batch endpoint is 403), and every
-- chart route is blocked too — editorial playlists 404/403, /browse/* 403, and
-- playlist track listings 403 even for user-owned playlists. So the figure
-- comes from Deezer's public API instead, whose `rank` field is keyless and
-- discriminates well (mainstream ~950k, indie ~120k, niche ~70k).
--
-- Nullable on purpose: a track Deezer can't match keeps null and falls back to
-- cached_at ordering rather than being ranked at zero.

alter table public.songs add column if not exists popularity int;

-- Matches the Trending ordering: popularity desc nulls last, then cached_at desc.
create index if not exists songs_popularity_idx
  on public.songs (popularity desc nulls last, cached_at desc);
