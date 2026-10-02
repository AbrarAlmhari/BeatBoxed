-- Preview source: iTunes, not Deezer.
--
-- Deezer blocks Supabase Edge Function egress — verified with and without a
-- custom User-Agent, so it's the IP, not the header. It also sends no
-- Access-Control-Allow-Origin, so the browser can't call it either. 0016's
-- deezer_id was never populated for a single row.
--
-- iTunes Search returns 30-second previews, needs no key, and sends
-- `Access-Control-Allow-Origin: *`, so the page looks a preview up directly
-- at play time. Only the matched track id is stored, so each song is searched
-- once; the preview URL is not cached because it is resolved per play.

alter table public.songs drop column if exists deezer_id;
alter table public.songs add column if not exists itunes_track_id bigint;

-- Remembers a confirmed miss, so a song with no match isn't re-searched on
-- every play. NULL id + checked = "we looked, there's nothing".
alter table public.songs add column if not exists itunes_checked_at timestamptz;

create index if not exists songs_itunes_track_id_idx
  on public.songs (itunes_track_id) where itunes_track_id is not null;
