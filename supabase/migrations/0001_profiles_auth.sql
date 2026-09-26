-- Auto-create a profiles row for every new auth user, and lock down profiles
-- with RLS. Run this in the Supabase SQL editor (DDL can't go through PostgREST).
--
-- Why a trigger instead of a client-side insert: this project keeps email
-- confirmation ON, so signUp() returns no session and the browser has no
-- authenticated role to insert with. A SECURITY DEFINER trigger runs as the
-- function owner, so it works before confirmation and can't leave an auth user
-- without a profile.

-- ---------------------------------------------------------------------------
-- 1. Trigger function
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. RLS on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
