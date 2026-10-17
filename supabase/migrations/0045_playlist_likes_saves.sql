-- Liking and saving other people's playlists, and playlists an owner keeps
-- private.
--
-- Additive: one new column with a default (playlists.is_private, off for
-- every existing playlist), two new tables, new functions, replaced select
-- policies on playlists and playlist_songs, one new notification switch.
-- No existing row is changed.
--
--   playlists                + is_private
--   notification_preferences + playlist_liked
--   new tables               playlist_likes, playlist_saves
--
-- Likes are public (a count, and the owner is told "X liked your
-- playlist"). Saves are private: the owner only ever sees the total.
-- A saved playlist is a link to the original, not a copy, so the saver
-- always sees the owner's current version.

-- ---------------------------------------------------------------------------
-- 1. Who can see a playlist
-- ---------------------------------------------------------------------------

alter table public.playlists
  add column if not exists is_private boolean not null default false;

-- The one place the rule lives. A playlist is visible when it isn't private
-- (or it's yours) and you can see its owner's account: a public account,
-- your own, or one you follow with an approved request.
--
-- Written out rather than calling can_view_profile(): that goes through
-- viewer_follows(), which only answers for the signed-in caller (0044
-- explains), and this is also asked on other people's behalf. Internal: no
-- API access, so it can't be used to find out who follows whom.
create or replace function public.playlist_visible_to(target_playlist uuid, viewer_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.playlists pl
      left join public.profiles p on p.id = pl.user_id
     where pl.id = target_playlist
       and viewer_id is not null
       and (
         viewer_id = pl.user_id
         or (
           not pl.is_private
           and (
             not coalesce(p.is_private, false)
             or exists (
               select 1
                 from public.user_follows uf
                where uf.follower_id = viewer_id
                  and uf.following_id = pl.user_id
                  and uf.status = 'accepted'
             )
           )
         )
       )
  );
$$;

revoke all on function public.playlist_visible_to(uuid, uuid) from public;
revoke execute on function public.playlist_visible_to(uuid, uuid) from anon;
revoke execute on function public.playlist_visible_to(uuid, uuid) from authenticated;

-- The same question for whoever is asking, for policies and the app.
create or replace function public.can_view_playlist(target_playlist uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.playlist_visible_to(target_playlist, auth.uid());
$$;

revoke all on function public.can_view_playlist(uuid) from public;
revoke execute on function public.can_view_playlist(uuid) from anon;
grant execute on function public.can_view_playlist(uuid) to authenticated;

-- Reading playlists and their songs now also respects a private playlist.
-- Same as 0022's rule otherwise (the account's privacy), plus the owner
-- always sees their own.
--
-- Every existing select policy on the two tables is dropped by lookup, as
-- 0022 did: policies combine with OR, so one left behind under a name not
-- recorded here would still show private playlists.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('playlists', 'playlist_songs')
       and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

create policy "Playlists are visible to those allowed"
  on public.playlists for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (not is_private and public.can_view_profile((select auth.uid()), user_id))
  );

create policy "Playlist songs are visible to those allowed"
  on public.playlist_songs for select
  to authenticated
  using (
    exists (
      select 1
        from public.playlists pl
       where pl.id = playlist_songs.playlist_id
         and (
           (select auth.uid()) = pl.user_id
           or (not pl.is_private and public.can_view_profile((select auth.uid()), pl.user_id))
         )
    )
  );

-- A profile's playlist count leaves out private playlists, except for the
-- owner looking at their own.
create or replace function public.playlist_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint
    from public.playlists
   where user_id = target
     and (not is_private or target = auth.uid());
$$;

revoke all on function public.playlist_count(uuid) from public;
revoke execute on function public.playlist_count(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. Likes (public)
-- ---------------------------------------------------------------------------

create table if not exists public.playlist_likes (
  user_id     uuid not null references public.profiles(id)  on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, playlist_id)
);

create index if not exists playlist_likes_playlist_idx on public.playlist_likes (playlist_id);

alter table public.playlist_likes enable row level security;

-- Visible when you can see the playlist and the account of whoever liked
-- it, so a private account's likes stay with its followers.
drop policy if exists "Playlist likes are visible with the playlist" on public.playlist_likes;
create policy "Playlist likes are visible with the playlist"
  on public.playlist_likes for select
  to authenticated
  using (
    public.can_view_playlist(playlist_id)
    and public.can_view_profile((select auth.uid()), user_id)
  );

drop policy if exists "Users like playlists as themselves" on public.playlist_likes;
create policy "Users like playlists as themselves"
  on public.playlist_likes for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.can_view_playlist(playlist_id));

drop policy if exists "Users remove their own playlist likes" on public.playlist_likes;
create policy "Users remove their own playlist likes"
  on public.playlist_likes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Saves (private)
-- ---------------------------------------------------------------------------

-- last_opened_at drives "N new songs": songs added after it.
create table if not exists public.playlist_saves (
  user_id        uuid not null references public.profiles(id)  on delete cascade,
  playlist_id    uuid not null references public.playlists(id) on delete cascade,
  created_at     timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  primary key (user_id, playlist_id)
);

create index if not exists playlist_saves_playlist_idx on public.playlist_saves (playlist_id);

alter table public.playlist_saves enable row level security;

-- Only the saver ever reads a save. The owner sees the total through
-- playlist_social(), never who.
drop policy if exists "Users read their own saves" on public.playlist_saves;
create policy "Users read their own saves"
  on public.playlist_saves for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users save playlists as themselves" on public.playlist_saves;
create policy "Users save playlists as themselves"
  on public.playlist_saves for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.can_view_playlist(playlist_id));

drop policy if exists "Users update their own saves" on public.playlist_saves;
create policy "Users update their own saves"
  on public.playlist_saves for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Removing a save stays possible after the playlist goes private, so the
-- "No longer available" row can be cleared.
drop policy if exists "Users remove their own saves" on public.playlist_saves;
create policy "Users remove their own saves"
  on public.playlist_saves for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. "X liked your playlist"
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  add column if not exists playlist_liked boolean not null default true;

-- Like, unlike, like doesn't stack a second row.
create unique index if not exists notifications_one_like_per_playlist
  on public.notifications (user_id, (payload ->> 'actor_id'), (payload ->> 'playlist_id'))
  where type = 'playlist_liked';

-- notify() with the playlist switch. Otherwise as in 0043.
create or replace function public.notify(
  recipient_id uuid,
  actor_id     uuid,
  notif_type   text,
  payload      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if recipient_id is null or actor_id is null or recipient_id = actor_id then
    return;
  end if;

  select case notif_type
           when 'review_liked'     then p.review_liked
           when 'review_commented' then p.review_commented
           when 'thread_reply'     then p.thread_reply
           when 'comment_reply'    then p.comment_reply
           when 'mention'          then p.mention
           when 'comment_liked'    then p.comment_liked
           when 'playlist_liked'   then p.playlist_liked
           when 'new_follower'     then p.new_follower
           when 'follow_requested' then p.follow_requests
           when 'follow_accepted'  then p.follow_accepted
           when 'artist_release'   then p.artist_release
           else true
         end
    into allowed
    from public.notification_preferences p
   where p.user_id = recipient_id;

  if allowed is false then
    return;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (recipient_id, notif_type, payload || jsonb_build_object('actor_id', actor_id))
  on conflict do nothing;
end;
$$;

revoke all on function public.notify(uuid, uuid, text, jsonb) from public;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from anon;
revoke execute on function public.notify(uuid, uuid, text, jsonb) from authenticated;

create or replace function public.on_playlist_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from public.playlists where id = new.playlist_id;
  if owner_id is null then return new; end if;
  perform public.notify(owner_id, new.user_id, 'playlist_liked', jsonb_build_object('playlist_id', new.playlist_id));
  return new;
end;
$$;

drop trigger if exists on_playlist_like_insert on public.playlist_likes;
create trigger on_playlist_like_insert
  after insert on public.playlist_likes
  for each row execute function public.on_playlist_like();

-- Unliking takes the notification back while it's unread.
create or replace function public.on_playlist_unlike()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
   where type = 'playlist_liked'
     and read = false
     and payload ->> 'actor_id' = old.user_id::text
     and payload ->> 'playlist_id' = old.playlist_id::text;
  return old;
end;
$$;

drop trigger if exists on_playlist_like_delete on public.playlist_likes;
create trigger on_playlist_like_delete
  after delete on public.playlist_likes
  for each row execute function public.on_playlist_unlike();

-- A deleted playlist takes its unread like notifications with it.
create or replace function public.on_playlist_delete_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
   where type = 'playlist_liked'
     and read = false
     and payload ->> 'playlist_id' = old.id::text;
  return old;
end;
$$;

drop trigger if exists on_playlist_delete_notifications on public.playlists;
create trigger on_playlist_delete_notifications
  after delete on public.playlists
  for each row execute function public.on_playlist_delete_notifications();

-- Unread counts per filter, now with playlist likes under Likes, grouped
-- per playlist the way the page shows them. Otherwise as in 0043.
create or replace function public.notification_unread_counts()
returns table (category text, unread int)
language sql
security invoker
set search_path = ''
stable
as $$
  with mine as (
    select n.type,
           coalesce(
             n.group_key,
             case when n.type = 'playlist_liked' then 'playlist_liked:' || (n.payload ->> 'playlist_id') end,
             n.id::text
           ) as item
      from public.notifications n
     where n.user_id = auth.uid()
       and n.read = false
       and n.type <> 'follow_requested'
  ),
  tagged as (
    select item,
           case
             when type = 'mention' then 'mentions'
             when type in ('comment_reply', 'thread_reply', 'review_commented') then 'replies'
             when type in ('review_liked', 'comment_liked', 'playlist_liked') then 'likes'
             when type in ('new_follower', 'follow_accepted') then 'follows'
             when type = 'artist_release' then 'artists'
             else 'other'
           end as category
      from mine
  )
  select 'all', count(distinct item)::int from tagged
  union all
  select f.name, count(distinct t.item)::int
    from unnest(array['mentions', 'replies', 'likes', 'follows', 'artists']) as f(name)
    left join tagged t on t.category = f.name
   group by f.name;
$$;

revoke all on function public.notification_unread_counts() from public;
revoke execute on function public.notification_unread_counts() from anon;
grant execute on function public.notification_unread_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the screens read, one request each
-- ---------------------------------------------------------------------------

-- The playlist page's numbers: likes and saves (totals only; who saved is
-- never returned), and whether you liked or saved it.
create or replace function public.playlist_social(target_playlist uuid)
returns table (like_count int, save_count int, liked_by_me boolean, saved_by_me boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select count(*) from public.playlist_likes l where l.playlist_id = target_playlist)::int,
    (select count(*) from public.playlist_saves s where s.playlist_id = target_playlist)::int,
    exists (select 1 from public.playlist_likes l where l.playlist_id = target_playlist and l.user_id = auth.uid()),
    exists (select 1 from public.playlist_saves s where s.playlist_id = target_playlist and s.user_id = auth.uid())
   where public.can_view_playlist(target_playlist);
$$;

revoke all on function public.playlist_social(uuid) from public;
revoke execute on function public.playlist_social(uuid) from anon;
grant execute on function public.playlist_social(uuid) to authenticated;

-- The Library's Saved tab. A playlist you can still see comes with its
-- owner, songs and "new since you last opened it"; one you can't (made
-- private, or the account went private without you) comes back bare, with
-- available = false and nothing about it, so the row can say so and offer
-- Remove. Deleted playlists are gone with their saves.
create or replace function public.my_saved_playlists()
returns table (
  playlist_id    uuid,
  available      boolean,
  title          text,
  cover_url      text,
  owner_id       uuid,
  owner_name     text,
  owner_avatar   text,
  song_count     int,
  new_songs      int,
  covers         text[],
  saved_at       timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    s.playlist_id,
    v.ok,
    case when v.ok then pl.title end,
    case when v.ok then pl.cover_url end,
    case when v.ok then pl.user_id end,
    case when v.ok then coalesce(p.display_name, p.username) end,
    case when v.ok then p.avatar_url end,
    case when v.ok then (select count(*) from public.playlist_songs ps where ps.playlist_id = pl.id)::int else 0 end,
    case when v.ok then (
      select count(*) from public.playlist_songs ps
       where ps.playlist_id = pl.id and ps.added_at > s.last_opened_at
    )::int else 0 end,
    case when v.ok then array(
      select a.cover_url
        from public.playlist_songs ps
        join public.songs so on so.id = ps.song_id
        join public.albums a on a.id = so.album_id
       where ps.playlist_id = pl.id and a.cover_url is not null
       order by ps.position
       limit 4
    ) else '{}'::text[] end,
    s.created_at
  from public.playlist_saves s
  join public.playlists pl on pl.id = s.playlist_id
  left join public.profiles p on p.id = pl.user_id
  cross join lateral (select public.playlist_visible_to(pl.id, auth.uid()) as ok) v
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;

revoke all on function public.my_saved_playlists() from public;
revoke execute on function public.my_saved_playlists() from anon;
grant execute on function public.my_saved_playlists() to authenticated;

-- Opening a saved playlist clears its "new songs".
create or replace function public.open_saved_playlist(target_playlist uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.playlist_saves
     set last_opened_at = now()
   where user_id = auth.uid() and playlist_id = target_playlist;
$$;

revoke all on function public.open_saved_playlist(uuid) from public;
revoke execute on function public.open_saved_playlist(uuid) from anon;
grant execute on function public.open_saved_playlist(uuid) to authenticated;

-- The playlists someone liked, for their profile's Likes tab: only when you
-- can see their account, and only playlists you can see.
create or replace function public.liked_playlists(target_user uuid, max_count int default 20)
returns table (
  playlist_id  uuid,
  title        text,
  cover_url    text,
  owner_id     uuid,
  owner_name   text,
  song_count   int,
  covers       text[],
  liked_at     timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    pl.id,
    pl.title,
    pl.cover_url,
    pl.user_id,
    coalesce(p.display_name, p.username),
    (select count(*) from public.playlist_songs ps where ps.playlist_id = pl.id)::int,
    array(
      select a.cover_url
        from public.playlist_songs ps
        join public.songs so on so.id = ps.song_id
        join public.albums a on a.id = so.album_id
       where ps.playlist_id = pl.id and a.cover_url is not null
       order by ps.position
       limit 4
    ),
    l.created_at
  from public.playlist_likes l
  join public.playlists pl on pl.id = l.playlist_id
  left join public.profiles p on p.id = pl.user_id
  where l.user_id = target_user
    and public.can_view_profile(auth.uid(), target_user)
    and public.playlist_visible_to(pl.id, auth.uid())
  order by l.created_at desc
  limit least(greatest(coalesce(max_count, 20), 1), 50);
$$;

revoke all on function public.liked_playlists(uuid, int) from public;
revoke execute on function public.liked_playlists(uuid, int) from anon;
grant execute on function public.liked_playlists(uuid, int) to authenticated;
