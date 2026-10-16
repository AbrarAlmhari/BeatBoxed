-- Undoes migrations/0039_onboarding.sql. Run by hand only, after 0040's
-- rollback (0040's For You uses tag_buckets()), and together with
-- reverting the frontend (/welcome, the tour and the welcome card read
-- these columns).
--
-- Lost: who has finished setup or the tour and the dismissed welcome cards
-- (the five profiles columns), and when each artist follow was made
-- (follows.created_at). The follows themselves, the music tags in
-- favorite_genres and everything else stay.
begin;

drop function if exists public.suggested_songs(uuid[], text[], int);
drop function if exists public.suggested_artists(text[], int);
drop function if exists public.suggested_reviewers_for_tags(text[], int);
drop function if exists public.tag_buckets(text[]);

drop trigger if exists profiles_music_tags on public.profiles;
drop function if exists public.check_music_tags();

alter table public.follows drop column if exists created_at;

alter table public.profiles drop column if exists welcome_card_dismissed_at;
alter table public.profiles drop column if exists tutorial_skipped_at;
alter table public.profiles drop column if exists tutorial_completed_at;
alter table public.profiles drop column if exists setup_step;
alter table public.profiles drop column if exists setup_completed_at;

commit;
