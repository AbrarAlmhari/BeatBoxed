-- Undoes migrations/0048_mood_week.sql. Run by hand only, together with
-- reverting the frontend (Home's check-in and song of the week cards, the
-- /week page) and deleting the song-vibes Edge Function.
--
-- Lost: every song label, the labelling queue and its daily counts, every
-- check-in, and the list of past songs of the week. Songs, reviews and
-- everything else stay. The pg_cron and pg_net extensions are left
-- installed (removing an extension is not something a rollback should do
-- blindly); only this migration's job and secret are removed.
begin;

-- The scheduled job and its secret.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'song-vibes-label') then
    perform cron.unschedule('song-vibes-label');
  end if;
end
$$;
delete from vault.secrets where name = 'song_vibes_cron';

drop function if exists public.song_vibe_coverage();
drop function if exists public.weekly_song_page(date);
drop function if exists public.current_weekly_song();
drop function if exists public.pick_checkin_song(date, jsonb, boolean);
drop function if exists public.skip_checkin(date);
drop function if exists public.checkin_day_ok(date);
drop function if exists public.song_vibes_secret_ok(text);
drop function if exists public.claim_song_vibes(int, int);

drop trigger if exists songs_queue_vibe on public.songs;
drop function if exists public.queue_new_song();

drop table if exists public.weekly_songs;
drop table if exists public.mood_checkins;
drop table if exists public.song_vibe_usage;
drop table if exists public.song_vibe_queue;
drop table if exists public.song_vibes;

commit;
