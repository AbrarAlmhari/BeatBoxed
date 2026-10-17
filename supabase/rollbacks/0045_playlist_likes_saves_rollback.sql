-- Undoes migrations/0045_playlist_likes_saves.sql. Run by hand only, after
-- 0046's rollback, and together with reverting the frontend (the playlist
-- page, Library's Saved tab, the profile Likes tab and Settings read these).
--
-- Lost: every playlist like and save, the playlist_liked switch, and which
-- playlists were private. NOTE: playlists that were private become visible
-- again to everyone who can see the owner's account, as before 0045.
-- Notifications of type playlist_liked stay; the old page doesn't show them.
begin;

drop function if exists public.liked_playlists(uuid, int);
drop function if exists public.open_saved_playlist(uuid);
drop function if exists public.my_saved_playlists();
drop function if exists public.playlist_social(uuid);

drop trigger if exists on_playlist_delete_notifications on public.playlists;
drop function if exists public.on_playlist_delete_notifications();
drop trigger if exists on_playlist_like_delete on public.playlist_likes;
drop function if exists public.on_playlist_unlike();
drop trigger if exists on_playlist_like_insert on public.playlist_likes;
drop function if exists public.on_playlist_like();

drop table if exists public.playlist_saves;
drop table if exists public.playlist_likes;

drop index if exists public.notifications_one_like_per_playlist;
alter table public.notification_preferences drop column if exists playlist_liked;

-- 0022's read policies, as they were.
drop policy if exists "Playlists are visible to those allowed" on public.playlists;
create policy "Playlists are visible when the owner allows it"
  on public.playlists for select
  to authenticated
  using (public.can_view_profile((select auth.uid()), user_id));

drop policy if exists "Playlist songs are visible to those allowed" on public.playlist_songs;
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

-- 0023's playlist_count(), as it was (it must not refer to is_private).
create or replace function public.playlist_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint from public.playlists where user_id = target;
$$;

revoke all on function public.playlist_count(uuid) from public;
revoke execute on function public.playlist_count(uuid) from anon;

drop function if exists public.can_view_playlist(uuid);
drop function if exists public.playlist_visible_to(uuid, uuid);

alter table public.playlists drop column if exists is_private;

-- 0043's notify(), as it was.
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

-- 0043's notification_unread_counts(), as it was.
create or replace function public.notification_unread_counts()
returns table (category text, unread int)
language sql
security invoker
set search_path = ''
stable
as $$
  with mine as (
    select n.type, coalesce(n.group_key, n.id::text) as item
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
             when type in ('review_liked', 'comment_liked') then 'likes'
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

commit;
