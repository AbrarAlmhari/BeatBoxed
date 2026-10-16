-- Undoes migrations/0037_username_rules.sql. Run by hand only, together
-- with reverting the frontend (the forms call username_available()).
--
-- Lost: nothing. Usernames already saved stay as they are; only the rule,
-- the exact availability check and the new signup fallbacks go away.
begin;

drop trigger if exists profiles_username_rules on public.profiles;
drop function if exists public.check_username();
drop function if exists public.username_available(text);

-- handle_new_user() as 0001 defined it.
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
      '[^a-zA-Z0-9_]', '', 'g'
    )
  );

  if base_username is null or base_username = '' then
    base_username := 'listener';
  end if;

  candidate := base_username;

  -- username may carry a unique constraint; walk suffixes until one sticks.
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
        candidate := base_username || suffix::text;
    end;
  end loop;

  return new;
end;
$$;

commit;
