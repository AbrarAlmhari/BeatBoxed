-- Username rules, for new usernames only:
--   4–20 characters: lowercase letters, numbers, _ and .
--   unique regardless of case (profiles_username_lower_key, from 0010)
--
-- Checked by a trigger, not a check constraint, and only when a username is
-- created or actually changed. Postgres re-checks a check constraint on every
-- update to the row, so an existing user with a short username (4 accounts
-- when this was written) would get an error editing their bio or avatar.
-- Those users keep their usernames; only a new one has to follow the rule.
--
-- Usernames are stored lowercase: the trigger lowercases what it's given, so
-- "Abrar" becomes "abrar". Capitals belong in the display name.
--
-- The service role (the team's admin key) is exempt from the length and
-- character rule, so scripts and tests can recreate an older short username.
--
-- handle_new_user() (signup) also changes: it keeps periods, and its own
-- fallbacks (a username taken from the email address, or "listener") now
-- produce names that pass the rule.
--
-- Undo with supabase/rollbacks/0037_username_rules_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. The rule, on insert and on a real change
-- ---------------------------------------------------------------------------

create or replace function public.check_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is null then
    return new;
  end if;

  new.username := lower(btrim(new.username));

  -- Unchanged (case aside): nothing to check, so short legacy names survive
  -- any other edit to the row.
  if tg_op = 'UPDATE' and new.username = lower(coalesce(old.username, '')) then
    return new;
  end if;

  -- The team's own service-role key (scripts, tests, fixing an account by
  -- hand) may set any username. Everything the app does goes through the
  -- rule: sign-up (handle_new_user) and Edit profile (the signed-in user).
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.username !~ '^[a-z0-9_.]{4,20}$' then
    raise exception 'Usernames are 4–20 characters: letters, numbers, _ and . only.'
      using errcode = '23514', hint = 'username_invalid';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_username_rules on public.profiles;
create trigger profiles_username_rules
  before insert or update of username on public.profiles
  for each row execute function public.check_username();

-- ---------------------------------------------------------------------------
-- 2. Signup: keep periods, and make the fallbacks valid
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  candidate     text;
  suffix        int := 0;
begin
  -- Re-running signup for an existing id must not error.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  base_username := lower(
    regexp_replace(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'username', ''),
        split_part(new.email, '@', 1)
      ),
      '[^a-zA-Z0-9_.]', '', 'g'
    )
  );

  if base_username is null or base_username = '' then
    base_username := 'listener';
  end if;
  -- Within the rule: at least 4 (padded with zeros), at most 20.
  base_username := left(rpad(base_username, 4, '0'), 20);

  candidate := base_username;

  -- Walk suffixes until one is free, keeping within 20 characters.
  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (
        new.id,
        candidate,
        coalesce(
          nullif(new.raw_user_meta_data ->> 'display_name', ''),
          base_username
        )
      );
      exit;
    exception
      when unique_violation then
        suffix := suffix + 1;
        if suffix > 50 then
          raise;
        end if;
        candidate := left(base_username, 20 - length(suffix::text)) || suffix::text;
    end;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. An exact availability check
-- ---------------------------------------------------------------------------

-- The app used ILIKE, where "_" matches any character, so "a_bc" looked
-- taken whenever "axbc" existed. This compares exactly, ignoring case.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p
     where lower(p.username) = lower(btrim(p_username))
  )
$$;

grant execute on function public.username_available(text) to anon, authenticated;

commit;
