-- 1. Search in any language. normalize_search_text (0024) kept only a-z
--    and 0-9, so an Arabic title was stored as an empty search text (39
--    songs) or lost its Arabic words, and accented letters (é, ñ) were
--    dropped too: those songs could never be found. It now keeps letters
--    and digits in every script, and matches Arabic the way people type
--    it: without diacritics or tatweel, with أ إ آ as ا and ى as ي. The
--    app's normalizeSearch() changes in step with it, so both sides still
--    agree.
--
--    This only replaces the function, which new and edited songs use from
--    now on. The 389 existing songs whose search text changes are rebuilt
--    separately, in small batches, by
--    supabase/scripts/0051_backfill_search_text.sql, so the songs table is
--    never held for long.
--
-- 2. The song labeller's daily cap counted every song handed out, before
--    any call was made, so failed calls (429s, errors) used it up.
--    release_song_vibes gives those calls back, and for a song that wasn't
--    actually tried (a 429, or a run stopped early) puts it back in the
--    queue without counting the attempt.
--
-- Safe while the app is in use: two functions are replaced or added; no
-- table changes. Rollback: supabase/rollbacks/0051_search_any_language_and_vibes_refund_rollback.sql

begin;

set local lock_timeout = '5s';

-- Steps, in order (the app's normalizeSearch() does the same):
--   lower case; drop apostrophes; drop Arabic diacritics (tashkeel,
--   U+064B-U+0652 and U+0670) and the tatweel (U+0640); read أ إ آ as ا
--   and ى as ي; anything that isn't a letter or digit, in any script,
--   becomes a space.
create or replace function public.normalize_search_text(input text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      translate(
        regexp_replace(
          regexp_replace(lower(coalesce(input, '')), '[''’`]', '', 'g'),
          '[\u064B-\u0652\u0670\u0640]', '', 'g'
        ),
        'أإآى', 'اااي'
      ),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$$;

revoke all on function public.normalize_search_text(text) from public;

-- Called by the song-vibes function (service role) after a run:
--   song_ids  the songs whose calls shouldn't count against today's cap
--   requeue   true for songs that weren't really tried (a 429, or left
--             over when a run stopped): their attempt is taken back and
--             they're due again at the next run. false for songs that
--             were tried and failed (a bad reply): the attempt and its
--             back-off stay, so a song that never works still gives up
--             after 5 tries.
create or replace function public.release_song_vibes(song_ids uuid[], requeue boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n     int := coalesce(cardinality(song_ids), 0);
begin
  if n = 0 then
    return;
  end if;

  update public.song_vibe_usage u
     set calls = greatest(0, u.calls - n)
   where u.day = today;

  if requeue then
    update public.song_vibe_queue q
       set attempts = greatest(0, q.attempts - 1),
           next_try_at = now()
     where q.song_id = any (song_ids);
  end if;
end;
$$;

revoke all on function public.release_song_vibes(uuid[], boolean) from public;
revoke execute on function public.release_song_vibes(uuid[], boolean) from anon, authenticated;
grant execute on function public.release_song_vibes(uuid[], boolean) to service_role;

commit;
