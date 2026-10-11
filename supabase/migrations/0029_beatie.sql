-- Beatie: a shared answer cache and daily usage limits.
--
-- Song explanations, line explanations and translations are the same for
-- every user who asks in the same language, so they're stored once and
-- served from here; only a cache miss calls Gemini. Chat answers depend on
-- the conversation and are never stored.
--
-- Two daily limits protect the Gemini free tier: 30 requests per user, and
-- 150 Gemini calls for the whole app. Both are taken by one function,
-- beatie_take_quota(), in single statements that lock the counter row, so
-- rapid or parallel requests can't slip past either limit. Cache hits count
-- against neither. Days roll over at midnight UTC.
--
-- Only the beatie Edge Function writes any of this, using the service role.
-- There are no client write policies at all.
--
-- All or nothing. Undo with supabase/rollbacks/0029_beatie_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. The cache
-- ---------------------------------------------------------------------------

create table if not exists public.beatie_cache (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references public.songs(id) on delete cascade,
  -- explain: "What's this song about?"
  -- line:      one lyric line explained
  -- translate: the whole song's lyrics, one translated line per original
  kind       text not null check (kind in ('explain', 'line', 'translate')),
  -- For kind = 'line', a hash of the normalised line; '' otherwise.
  line_key   text not null default '',
  -- The language the answer is written in (profiles.translation_language).
  language   text not null,
  -- Plain text for explain/line; a JSON array of strings for translate.
  content    text not null,
  -- Whether lyrics were available when this was written. An answer made
  -- without lyrics says so, and the page shows a note beside it.
  has_lyrics boolean not null,
  created_at timestamptz not null default now(),
  constraint beatie_cache_key unique (song_id, kind, line_key, language)
);

alter table public.beatie_cache enable row level security;

-- Anyone signed in can read answers; they're about songs, not people.
drop policy if exists "Signed-in users read Beatie answers" on public.beatie_cache;
create policy "Signed-in users read Beatie answers"
  on public.beatie_cache for select to authenticated
  using (true);

revoke all on table public.beatie_cache from anon;
revoke insert, update, delete on table public.beatie_cache from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Daily usage
-- ---------------------------------------------------------------------------

-- Per user per day. Users can see their own row; nobody can write it.
create table if not exists public.beatie_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  count   int  not null default 0 check (count >= 0),
  constraint beatie_usage_pkey primary key (user_id, day)
);

alter table public.beatie_usage enable row level security;

drop policy if exists "Users see their own Beatie usage" on public.beatie_usage;
create policy "Users see their own Beatie usage"
  on public.beatie_usage for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.beatie_usage from anon;
revoke insert, update, delete on table public.beatie_usage from authenticated;

-- The whole app's Gemini calls per day. No client access of any kind.
create table if not exists public.beatie_global_usage (
  day   date primary key,
  count int  not null default 0 check (count >= 0)
);

alter table public.beatie_global_usage enable row level security;
revoke all on table public.beatie_global_usage from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Taking a request from both limits
--
-- Returns 'ok', 'user_limit' or 'global_limit'. With p_user null it takes
-- from the global cap only: that's the safety-check and translation retries,
-- which are real Gemini calls but not a new request from the user.
--
-- Each upsert either adds one or, when the row is already at its limit,
-- matches nothing (the WHERE on DO UPDATE), and it holds the row lock while
-- it does, so concurrent calls are counted one after another. A user taken
-- but then refused by the global cap is given their unit back.
-- ---------------------------------------------------------------------------

create or replace function public.beatie_take_quota(
  p_user         uuid,
  p_user_limit   int,
  p_global_limit int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  taken int;
begin
  if p_user is not null then
    insert into public.beatie_usage as u (user_id, day, count)
    values (p_user, today, 1)
    on conflict (user_id, day) do update
       set count = u.count + 1
     where u.count < p_user_limit
    returning u.count into taken;
    if taken is null then
      return 'user_limit';
    end if;
  end if;

  taken := null;
  insert into public.beatie_global_usage as g (day, count)
  values (today, 1)
  on conflict (day) do update
     set count = g.count + 1
   where g.count < p_global_limit
  returning g.count into taken;

  if taken is null then
    if p_user is not null then
      update public.beatie_usage
         set count = greatest(count - 1, 0)
       where user_id = p_user and day = today;
    end if;
    return 'global_limit';
  end if;

  return 'ok';
end;
$$;

-- Only the Edge Function (service role) may take quota. A signed-in user
-- calling this over RPC could otherwise burn other people's global budget.
revoke all on function public.beatie_take_quota(uuid, int, int) from public;
revoke execute on function public.beatie_take_quota(uuid, int, int) from anon, authenticated;
grant execute on function public.beatie_take_quota(uuid, int, int) to service_role;

commit;
