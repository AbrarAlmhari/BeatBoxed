-- Deezer track id, so a match is found once and reused.
--
-- Only the id is stored, never the preview URL: Deezer's preview links are
-- signed and expire, so a cached URL would start 403-ing. The song-preview
-- Edge Function fetches a fresh link at play time using this id.

alter table public.songs add column if not exists deezer_id bigint;

create index if not exists songs_deezer_id_idx
  on public.songs (deezer_id) where deezer_id is not null;
