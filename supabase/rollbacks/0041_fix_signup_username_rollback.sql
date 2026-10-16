-- Undoes migrations/0041_fix_signup_username.sql: handle_new_user() as 0037
-- left it (which cuts new usernames to 4 characters). Run by hand only.
-- Lost: nothing.
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

commit;
