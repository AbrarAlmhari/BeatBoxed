-- Account privacy.
--
-- Public (the default) is today's behaviour: any signed-in user can see your
-- reviews, playlists, followed artists and friends list. Private limits all
-- four to accepted friends. What a non-friend still sees on a private
-- profile is everything on the profiles row itself — avatar, name, username,
-- bio — plus the stat counts and the Add friend button.
--
-- Enforced in RLS rather than in the pages, because the review feed will
-- query reviews directly and anything hidden only in the UI would leak
-- there. Every new query over reviews, playlists, playlist_songs or follows
-- inherits this automatically; a feed needs no privacy code of its own.

alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- ---------------------------------------------------------------------------
-- The shared rule
-- ---------------------------------------------------------------------------

-- security definer because it reads profiles.is_private and friendships for
-- someone other than the viewer, both of which the viewer's own policies
-- would otherwise restrict. stable so the planner can call it once per row
-- group rather than per row.
create or replace function public.can_view_profile(viewer_id uuid, owner_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    viewer_id is not null
    and owner_id is not null
    and (
      viewer_id = owner_id
      or not coalesce(
        (select p.is_private from public.profiles p where p.id = owner_id),
        false
      )
      or exists (
        select 1
          from public.friendships f
         where f.status = 'accepted'
           and (
             (f.user_id = viewer_id and f.friend_id = owner_id)
             or (f.user_id = owner_id and f.friend_id = viewer_id)
           )
      )
    );
$$;

revoke all on function public.can_view_profile(uuid, uuid) from public;
revoke execute on function public.can_view_profile(uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- Select policies
--
-- Dropped by lookup: several of these predate this migration series and
-- their names aren't recorded in the repo.
-- ---------------------------------------------------------------------------

do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('reviews', 'playlists', 'playlist_songs', 'follows')
       and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

create policy "Reviews are visible when the author allows it"
  on public.reviews for select
  to authenticated
  using (public.can_view_profile((select auth.uid()), user_id));

create policy "Playlists are visible when the owner allows it"
  on public.playlists for select
  to authenticated
  using (public.can_view_profile((select auth.uid()), user_id));

-- playlist_songs has no user of its own, so ownership comes from the parent.
create policy "Playlist songs are visible when the owner allows it"
  on public.playlist_songs for select
  to authenticated
  using (
    exists (
      select 1
        from public.playlists pl
       where pl.id = playlist_songs.playlist_id
         and public.can_view_profile((select auth.uid()), pl.user_id)
    )
  );

-- Your own follows are always visible to you, which is what the follow
-- button and Home's For You rail read, so both keep working unchanged.
create policy "Follows are visible when the follower allows it"
  on public.follows for select
  to authenticated
  using (public.can_view_profile((select auth.uid()), user_id));

-- ---------------------------------------------------------------------------
-- get_friends: privacy as well as the existing visibility toggle
-- ---------------------------------------------------------------------------

create or replace function public.get_friends(target uuid)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_id = target then f.friend_id else f.user_id end
  where f.status = 'accepted'
    and (f.user_id = target or f.friend_id = target)
    -- A private account's friends list is friends-only, like everything else.
    and public.can_view_profile((select auth.uid()), target)
    -- Hidden lists return nothing to anyone but the owner, independently of
    -- whether the account is private.
    and (
      coalesce(
        (select pr.friends_list_visible from public.profiles pr where pr.id = target),
        true
      )
      or (select auth.uid()) = target
    )
  order by lower(coalesce(p.display_name, p.username, ''));
$$;

revoke all on function public.get_friends(uuid) from public;
revoke execute on function public.get_friends(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Counts and ratings that must survive the new policies
-- ---------------------------------------------------------------------------

-- A private user's ratings still count towards a song, anonymously. The
-- client used to fetch raw review rows and average them, which now returns
-- only the visible ones and would quietly drop private users from every
-- song's score. These return aggregates and never the reviews themselves.
create or replace function public.song_rating_stats(song_ids uuid[])
returns table (
  song_id      uuid,
  rating_avg   numeric,
  review_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select r.song_id, avg(r.rating)::numeric, count(*)::bigint
    from public.reviews r
   where r.song_id = any(song_ids)
   group by r.song_id;
$$;

revoke all on function public.song_rating_stats(uuid[]) from public;
revoke execute on function public.song_rating_stats(uuid[]) from anon;

-- A private profile still shows its numbers to a non-friend; only the rows
-- behind them are hidden. Counted here for the same reason friend_count()
-- already exists.
create or replace function public.review_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint from public.reviews where user_id = target;
$$;

revoke all on function public.review_count(uuid) from public;
revoke execute on function public.review_count(uuid) from anon;

create or replace function public.following_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint from public.follows where user_id = target;
$$;

revoke all on function public.following_count(uuid) from public;
revoke execute on function public.following_count(uuid) from anon;

-- Indexes these counts and the policy checks lean on.
create index if not exists reviews_user_idx on public.reviews (user_id);
create index if not exists friendships_accepted_pair_idx
  on public.friendships (user_id, friend_id) where status = 'accepted';
