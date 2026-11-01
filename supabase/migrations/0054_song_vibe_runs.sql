-- A small log of the song labeller's runs, for sizing its daily cap.
--
-- The cron job's own record of each answer (net._http_response) is
-- cleared after about 6 hours, before a day of runs can be read. This
-- keeps each run that labelled anything for 30 days.
--
-- Numbers only: when it ran, songs and outcomes, calls given back, tokens
-- (prompt / reasoning / answer) and Groq's limit and remaining figures as
-- its last answer reported them. Never a key, a header or any text.
--
-- Only the server (the song-vibes function, as service_role) reads or
-- writes it: row level security is on with no policies, and signed-in
-- users and anon have no grants at all.
--
-- Rows older than 30 days are deleted every night at 03:30 UTC.
begin;

set local lock_timeout = '5s';

create table if not exists public.song_vibe_runs (
  id                      bigint generated always as identity primary key,
  ran_at                  timestamptz not null default now(),
  claimed                 int not null default 0,
  labelled                int not null default 0,
  failed                  int not null default 0,
  invalid                 int not null default 0,
  busy                    int not null default 0,
  given_back              int not null default 0,
  requeued                int not null default 0,
  calls                   int not null default 0,
  prompt_tokens           int not null default 0,
  reasoning_tokens        int not null default 0,
  answer_tokens           int not null default 0,
  -- Groq's figures from the run's last call; null when it sent none.
  requests_per_day        int,
  requests_left_today     int,
  tokens_per_minute       int,
  tokens_left_this_minute int
);

create index if not exists song_vibe_runs_ran_at on public.song_vibe_runs (ran_at);

alter table public.song_vibe_runs enable row level security;
-- No policies: nobody but the service role.
revoke all on table public.song_vibe_runs from public, anon, authenticated;
grant select, insert, delete on table public.song_vibe_runs to service_role;

-- Nightly clean-up of rows older than 30 days.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'song-vibe-runs-cleanup') then
    perform cron.unschedule('song-vibe-runs-cleanup');
  end if;
end
$$;

select cron.schedule(
  'song-vibe-runs-cleanup',
  '30 3 * * *',
  $job$ delete from public.song_vibe_runs where ran_at < now() - interval '30 days' $job$
);

commit;
