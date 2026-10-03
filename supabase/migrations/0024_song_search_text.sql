-- One searchable column per song: its title and its artist's name together,
-- lowercased and stripped of punctuation.
--
-- Search used to run two queries — title ILIKE, artist ILIKE — and merge
-- them, so a query that spanned both ("karma police radiohead") matched
-- neither side and returned nothing. One column lets every word be checked
-- against the pair in a single query.
--
-- Trigram (pg_trgm GIN), not full text, for two reasons:
--
--   1. Partial words have to match mid-type, and ILIKE '%pol%' is a
--      substring test. A tsquery can do prefixes ('pol:*') but not infixes,
--      so "adio" would never find Radiohead under full text while it does
--      here.
--   2. Full text would bring a stemmer and a language choice with it. This
--      catalog is multilingual — Arabic, Hindi and Korean titles are already
--      in it — and no single text search configuration suits them. Trigrams
--      are language agnostic.
--
-- The cost is that trigram indexes only help for patterns of three or more
-- characters; a one or two letter word falls back to a scan. At this
-- catalog's size that is still fast, and the result is correct either way.

create extension if not exists pg_trgm;

-- Both sides of the comparison normalise identically; the client has a
-- matching normalizeSearch() in src/lib/catalog.ts. Apostrophes are removed
-- rather than replaced so "God's Plan" becomes "gods plan" and matches a
-- query typed without the apostrophe. Everything else non-alphanumeric
-- becomes a space, so "rock-n-roll" stays three words.
create or replace function public.normalize_search_text(input text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(input, '')), '[''’`]', '', 'g'),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;

alter table public.songs add column if not exists search_text text;

-- ---------------------------------------------------------------------------
-- Kept current automatically
-- ---------------------------------------------------------------------------

create or replace function public.songs_set_search_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.search_text := public.normalize_search_text(
    coalesce(new.title, '') || ' ' ||
    coalesce((select a.name from public.artists a where a.id = new.artist_id), '')
  );
  return new;
end;
$$;

-- Scoped to the columns it derives from, so the artist trigger below can
-- write search_text without re-entering this one.
drop trigger if exists songs_set_search_text on public.songs;
create trigger songs_set_search_text
  before insert or update of title, artist_id on public.songs
  for each row execute function public.songs_set_search_text();

-- A rename has to reach every song by that artist, or the column silently
-- drifts out of date and search starts missing rows for no visible reason.
create or replace function public.artists_refresh_song_search_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update public.songs s
       set search_text = public.normalize_search_text(
             coalesce(s.title, '') || ' ' || coalesce(new.name, '')
           )
     where s.artist_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists artists_refresh_song_search_text on public.artists;
create trigger artists_refresh_song_search_text
  after update of name on public.artists
  for each row execute function public.artists_refresh_song_search_text();

revoke all on function public.normalize_search_text(text) from public;
revoke all on function public.songs_set_search_text() from public;
revoke all on function public.artists_refresh_song_search_text() from public;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

update public.songs s
   set search_text = public.normalize_search_text(
         coalesce(s.title, '') || ' ' || coalesce(a.name, '')
       )
  from public.artists a
 where a.id = s.artist_id;

-- Songs with no artist row still need to be findable by title.
update public.songs s
   set search_text = public.normalize_search_text(coalesce(s.title, ''))
 where s.artist_id is null;

create index if not exists songs_search_text_trgm
  on public.songs using gin (search_text gin_trgm_ops);
