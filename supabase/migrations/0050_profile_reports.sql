-- Report a profile (the profile ⋯ menu's Report).
--
-- Additive: one new table, no existing row or function changed. Safe while
-- the app is in use. Rollback: supabase/rollbacks/0050_profile_reports_rollback.sql
--
-- People file reports only as themselves and can't read any back, their own
-- included; reports are for the team, in the dashboard. One open report per
-- person per profile, never about yourself. When either account is deleted,
-- its reports go with it.

begin;

create table if not exists public.profile_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'harassment', 'hate', 'inappropriate', 'other')),
  details     text check (details is null or char_length(details) <= 500),
  status      text not null default 'open' check (status in ('open', 'reviewed')),
  created_at  timestamptz not null default now(),
  constraint profile_reports_not_self check (reporter_id <> reported_id)
);

-- One open report per person per profile; once the team marks it reviewed,
-- the same person can report again.
create unique index if not exists profile_reports_one_open
  on public.profile_reports (reporter_id, reported_id)
  where status = 'open';

create index if not exists profile_reports_reported_idx
  on public.profile_reports (reported_id, created_at desc);

alter table public.profile_reports enable row level security;

-- File a report as yourself, as a new open report. There is deliberately no
-- select, update or delete policy: nobody reads or changes reports from the
-- app.
drop policy if exists "Users report as themselves" on public.profile_reports;
create policy "Users report as themselves"
  on public.profile_reports for insert
  to authenticated
  with check (reporter_id = auth.uid() and status = 'open');

revoke all on public.profile_reports from anon;

commit;
