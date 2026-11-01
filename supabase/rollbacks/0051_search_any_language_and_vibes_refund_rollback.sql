-- Undoes migrations/0051_search_any_language_and_vibes_refund.sql. Run by
-- hand only, together with reverting the app (normalizeSearch in
-- src/lib/catalog.ts) and the song-vibes function (it calls
-- release_song_vibes).
--
-- After this, run supabase/scripts/0051_backfill_search_text.sql until it
-- returns 0, to put the stored search text back to the a-z / 0-9 rule
-- (Arabic and accented titles become unsearchable again).
--
-- Lost: nothing stored. Calls already given back by release_song_vibes
-- stay given back.
begin;

set local lock_timeout = '5s';

-- The 0024 version, as it was.
create or replace function public.normalize_search_text(input text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(input, '')), '[''’`]', '', 'g'),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;

revoke all on function public.normalize_search_text(text) from public;

drop function if exists public.release_song_vibes(uuid[], boolean);

commit;
