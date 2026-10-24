-- Undoes migrations/0054_song_vibe_runs.sql. Run by hand only, after
-- redeploying song-vibes without the run log (or its inserts just fail
-- and are logged; labelling carries on either way).
--
-- Lost: the run log itself (counts only).
begin;

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'song-vibe-runs-cleanup') then
    perform cron.unschedule('song-vibe-runs-cleanup');
  end if;
end
$$;

drop table if exists public.song_vibe_runs;

commit;
