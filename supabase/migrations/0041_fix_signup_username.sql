-- Fixes signup usernames being cut to 4 characters.
--
-- 0037 meant to pad short usernames to 4 characters with
-- rpad(name, 4, '0'), but rpad also truncates anything longer to 4, so
-- every new signup's username was cut short ("sara.music" became "sara").
-- Checked when this was found: the one account created since 0037 typed a
-- 4-character username, so no existing username was changed by the bug,
-- and this migration changes none.
--
-- Only handle_new_user() changes: pad when shorter than 4, cut when longer
-- than 20, otherwise keep the name as typed. Undo with
-- supabase/rollbacks/0041_fix_signup_username_rollback.sql.
begin;

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
  -- Within the rule: at least 4 (padded with zeros), at most 20. rpad()
  -- also cuts a longer value down to the given length, so it's only used
  -- on names that are too short.
  if char_length(base_username) < 4 then
    base_username := rpad(base_username, 4, '0');
  end if;
  base_username := left(base_username, 20);

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

commit;
