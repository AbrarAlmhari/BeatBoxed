-- "New release from an artist you follow" notifications.
--
-- Rows are written by notify() like every other social type, so the
-- preference switch below is honoured without the caller knowing about it,
-- and nobody can forge one (0021 revoked execute on notify from anon and
-- authenticated; only security definer callers reach it).

alter table public.notification_preferences
  add column if not exists artist_release boolean not null default true;

-- notify() gains the new type. Everything else is unchanged from 0021 --
-- restated in full because create or replace needs the whole body.
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
           when 'friend_accepted'  then p.friend_accepted
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

-- One notification per person per album, ever. Without this, every
-- discography re-sync inside the 14-day window would notify again.
--
-- notify() stamps actor_id into the payload; for a release the actor is the
-- artist, so (recipient, artist, album) is the natural key.
create unique index if not exists notifications_one_release_per_album
  on public.notifications (
    user_id,
    (payload ->> 'actor_id'),
    (payload ->> 'album_id')
  )
  where type = 'artist_release';

-- ---------------------------------------------------------------------------
-- Fan-out
-- ---------------------------------------------------------------------------

-- Tells every follower about one album.
--
-- Deliberately not a trigger on albums. A trigger would fire for the entire
-- back catalogue the first time an artist is synced, which is exactly the
-- flood this must avoid, and it could not tell a newly released album from
-- an old one being cached for the first time. The caller decides what counts
-- as new; this only fans out.
--
-- The caller must pass an album that is genuinely new: released within the
-- last 14 days, and not already in the database before this sync. The
-- freshness check is repeated here as a backstop, because a bug upstream
-- would otherwise be unrecoverable -- notifications cannot be unsent.
create or replace function public.notify_artist_release(
  target_artist uuid,
  target_album  uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released date;
  sent     integer := 0;
  follower record;
begin
  select a.release_date::date into released
    from public.albums a
   where a.id = target_album and a.artist_id = target_artist;

  -- No album, no date, or not actually recent: say nothing.
  if released is null or released < (current_date - interval '14 days') then
    return 0;
  end if;

  for follower in
    select f.user_id from public.follows f where f.artist_id = target_artist
  loop
    -- notify() drops the case where recipient = actor, which can't happen
    -- here (an artist id is not a user id), and applies the preference.
    perform public.notify(
      follower.user_id,
      target_artist,
      'artist_release',
      jsonb_build_object('album_id', target_album, 'artist_id', target_artist)
    );
    sent := sent + 1;
  end loop;

  return sent;
end;
$$;

-- Called by the spotify-artist Edge Function with the service role, never
-- from a browser: a user must not be able to blast notifications to an
-- artist's followers.
revoke all on function public.notify_artist_release(uuid, uuid) from public;
revoke execute on function public.notify_artist_release(uuid, uuid) from anon;
revoke execute on function public.notify_artist_release(uuid, uuid) from authenticated;
