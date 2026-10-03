-- What the artist and album pages need beyond today's catalog columns.
--
-- Nothing here changes existing data or policies: it is new nullable columns,
-- two counters and some indexes. The catalog tables stay read-public and
-- service-role-write, as 0002 set them up.

-- ---------------------------------------------------------------------------
-- Track ordering
-- ---------------------------------------------------------------------------

-- An album has to list in its real order, and multi-disc releases need the
-- disc to group by. Nullable: songs cached from search have no album context
-- and will never have these.
alter table public.songs add column if not exists track_number smallint;
alter table public.songs add column if not exists disc_number  smallint;

-- The album page reads its tracks in this order on every visit.
create index if not exists songs_album_order_idx
  on public.songs (album_id, disc_number, track_number)
  where album_id is not null;

-- ---------------------------------------------------------------------------
-- Album completeness
-- ---------------------------------------------------------------------------

-- Spotify's own count, so the page can tell "we have all 12" from "we have
-- cached 4 so far" and fetch the rest instead of showing a half-empty album.
alter table public.albums add column if not exists total_tracks smallint;

-- album | single | compilation, straight from Spotify. Drives the
-- Albums / Singles & EPs split and the type shown in the album header.
alter table public.albums add column if not exists album_type text;

create index if not exists albums_artist_release_idx
  on public.albums (artist_id, release_date desc);

-- ---------------------------------------------------------------------------
-- Artist page extras
-- ---------------------------------------------------------------------------

-- Wikipedia summary, matched through Wikidata's Spotify artist ID property
-- (P1902) rather than by name, so a band called "Low" can't pick up the
-- article about temperature. Null means no confident match, and the page
-- shows no bio at all rather than a wrong one.
alter table public.artists add column if not exists bio text;
-- The article URL, because Wikipedia's licence requires attribution with a
-- link back.
alter table public.artists add column if not exists bio_url text;
alter table public.artists add column if not exists bio_fetched_at timestamptz;
-- Null means never synced. The page serves whatever is cached immediately
-- and refreshes behind the scenes once this is older than a day.
alter table public.artists add column if not exists discography_synced_at timestamptz;

-- ---------------------------------------------------------------------------
-- Follower count
-- ---------------------------------------------------------------------------

-- Beatboxed followers, not Spotify's -- the artist object this app receives
-- has no followers field at all (verified: its only keys are external_urls,
-- href, id, images, name, type, uri).
--
-- security definer for the same reason review_count() and following_count()
-- exist: after 0022, follows rows belonging to private users are hidden, so
-- a direct count would under-report an artist's followers depending on who
-- is looking. This returns the number and never the rows.
create or replace function public.artist_follower_count(target uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::bigint from public.follows where artist_id = target;
$$;

revoke all on function public.artist_follower_count(uuid) from public;
revoke execute on function public.artist_follower_count(uuid) from anon;

create index if not exists follows_artist_idx on public.follows (artist_id);
