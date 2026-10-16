-- Artist genres (Part C): stored per artist, grouped into a short list of
-- buckets through mapping tables the team can edit, and counted on the
-- profile's Stats tab.
--
--   artists.genres_raw         genre names as the source gave them
--   artists.genres_source      wikidata | musicbrainz | none
--   artists.genres_fetched_at  when they were looked up (null: never)
--
-- Raw genres come from Wikidata's "genre" (P136), found through the
-- artist's Spotify ID (P1902) like the bio, or failing that from
-- MusicBrainz's genre tags. scripts/backfill-artist-genres.mjs fills them.
-- The old `artists.genres` (Spotify's, always empty) and `songs.genre` are
-- left exactly as they are.
--
-- Mapping a raw genre to a bucket:
--   1. genre_map: an exact (lower-case) name, e.g. 'dance-pop' -> Pop
--   2. genre_patterns: the first LIKE pattern by priority, e.g. '%metal%'
--   3. otherwise 'Other', and it shows up in the genre_unmapped view so the
--      mapping can be extended.
-- An artist gets at most 2 buckets: the ones most of their genres fall in,
-- ties broken by the bucket's priority. Editing either table changes every
-- artist's buckets at once; nothing is stored per artist but the raw names.
--
-- Adds columns, tables, functions and a view; changes no existing data.
-- Undo with supabase/rollbacks/0031_artist_genres_rollback.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Per-artist storage
-- ---------------------------------------------------------------------------

alter table public.artists add column if not exists genres_raw text[];
alter table public.artists add column if not exists genres_source text
  check (genres_source in ('wikidata', 'musicbrainz', 'none'));
alter table public.artists add column if not exists genres_fetched_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Buckets and the mapping
-- ---------------------------------------------------------------------------

create table if not exists public.genre_buckets (
  name        text primary key,
  -- Shorter, for charts and chips ('Indie & Alt').
  short_label text not null,
  -- Lower comes first when an artist's genres tie between buckets.
  priority    int  not null
);

insert into public.genre_buckets (name, short_label, priority) values
  ('Arabic',              'Arabic',     10),
  ('Khaleeji',            'Khaleeji',   20),
  ('K-Pop',               'K-Pop',      30),
  ('Latin',               'Latin',      40),
  ('Hip-Hop & Rap',       'Hip-Hop',    50),
  ('R&B & Soul',          'R&B & Soul', 60),
  ('Metal',               'Metal',      70),
  ('Indie & Alternative', 'Indie & Alt', 80),
  ('Electronic & Dance',  'Electronic', 90),
  ('Jazz & Blues',        'Jazz & Blues', 100),
  ('Classical',           'Classical', 110),
  ('Country & Folk',      'Country & Folk', 120),
  ('Rock',                'Rock',      130),
  ('Pop',                 'Pop',       140),
  ('Other',               'Other',     999)
on conflict (name) do nothing;

create table if not exists public.genre_map (
  raw    text primary key check (raw = lower(raw)),
  bucket text not null references public.genre_buckets(name) on update cascade
);

create table if not exists public.genre_patterns (
  pattern  text primary key check (pattern = lower(pattern)),
  bucket   text not null references public.genre_buckets(name) on update cascade,
  -- Lower is tried first: '%arab%' before '%pop%', so 'arabic pop' is Arabic.
  priority int  not null
);

-- Exact names that the patterns would get wrong, or that are clearer listed.
insert into public.genre_map (raw, bucket) values
  ('pop music', 'Pop'), ('dance-pop', 'Pop'), ('teen pop', 'Pop'), ('pop', 'Pop'),
  ('europop', 'Pop'), ('adult contemporary music', 'Pop'), ('bubblegum pop', 'Pop'),
  ('rock music', 'Rock'), ('pop rock', 'Rock'), ('soft rock', 'Rock'),
  ('contemporary r&b', 'R&B & Soul'), ('rhythm and blues', 'R&B & Soul'), ('soul music', 'R&B & Soul'),
  ('hip-hop', 'Hip-Hop & Rap'), ('hip hop music', 'Hip-Hop & Rap'), ('afrobeats', 'Hip-Hop & Rap'),
  ('k-pop', 'K-Pop'), ('korean hip-hop', 'K-Pop'), ('korean ballad', 'K-Pop'),
  ('khaliji', 'Khaleeji'), ('khaleeji', 'Khaleeji'), ('sawt', 'Khaleeji'), ('shailat', 'Khaleeji'),
  ('rai', 'Arabic'), ('raï', 'Arabic'), ('tarab', 'Arabic'), ('mahraganat', 'Arabic'),
  ('shaabi', 'Arabic'), ('sha''abi', 'Arabic'), ('dabke', 'Arabic'), ('mawwal', 'Arabic'),
  ('music of egypt', 'Arabic'), ('music of lebanon', 'Arabic'), ('arabic music', 'Arabic'),
  ('soundtrack', 'Other'), ('film score', 'Classical'), ('video game music', 'Other'),
  ('singer-songwriter', 'Country & Folk'), ('christian music', 'Other'), ('gospel music', 'R&B & Soul'),
  ('reggae', 'Other'), ('dancehall', 'Other'), ('ska', 'Other'),
  ('new wave', 'Rock'), ('post-punk', 'Indie & Alternative'), ('emo', 'Indie & Alternative'),
  ('grunge', 'Indie & Alternative'), ('britpop', 'Indie & Alternative'), ('shoegaze', 'Indie & Alternative'),
  ('disco', 'Electronic & Dance'), ('trap music', 'Hip-Hop & Rap'), ('drill music', 'Hip-Hop & Rap'),
  ('j-pop', 'Pop'), ('c-pop', 'Pop'), ('bollywood', 'Other'), ('filmi', 'Other')
on conflict (raw) do nothing;

insert into public.genre_patterns (pattern, bucket, priority) values
  ('%k-pop%', 'K-Pop', 10), ('%korean%', 'K-Pop', 11),
  ('%khaliji%', 'Khaleeji', 20), ('%khaleeji%', 'Khaleeji', 21), ('%gulf%', 'Khaleeji', 22),
  ('%saudi%', 'Khaleeji', 23), ('%emirati%', 'Khaleeji', 24), ('%kuwaiti%', 'Khaleeji', 25),
  ('%bahraini%', 'Khaleeji', 26), ('%qatari%', 'Khaleeji', 27), ('%omani%', 'Khaleeji', 28), ('%yemeni%', 'Khaleeji', 29),
  ('%arab%', 'Arabic', 30), ('%egypt%', 'Arabic', 31), ('%leban%', 'Arabic', 32), ('%syria%', 'Arabic', 33),
  ('%iraq%', 'Arabic', 34), ('%moroc%', 'Arabic', 35), ('%algeri%', 'Arabic', 36), ('%tunisia%', 'Arabic', 37),
  ('%levant%', 'Arabic', 38), ('%palestin%', 'Arabic', 39), ('%jordan%', 'Arabic', 40), ('%sudan%', 'Arabic', 41),
  ('%mahragan%', 'Arabic', 42), ('%shaabi%', 'Arabic', 43), ('%tarab%', 'Arabic', 44), ('%dabke%', 'Arabic', 45),
  ('%latin%', 'Latin', 50), ('%reggaeton%', 'Latin', 51), ('%salsa%', 'Latin', 52), ('%bachata%', 'Latin', 53),
  ('%cumbia%', 'Latin', 54), ('%samba%', 'Latin', 55), ('%bossa nova%', 'Latin', 56), ('%flamenco%', 'Latin', 57),
  ('%tango%', 'Latin', 58), ('%merengue%', 'Latin', 59), ('%mariachi%', 'Latin', 60), ('%ranchera%', 'Latin', 61),
  ('%corrido%', 'Latin', 62), ('%sertanejo%', 'Latin', 63), ('%dembow%', 'Latin', 64), ('%mpb%', 'Latin', 65),
  ('%metal%', 'Metal', 70), ('%grindcore%', 'Metal', 71), ('%deathcore%', 'Metal', 72),
  ('%hip hop%', 'Hip-Hop & Rap', 80), ('%hip-hop%', 'Hip-Hop & Rap', 81), ('%rap%', 'Hip-Hop & Rap', 82),
  ('%trap%', 'Hip-Hop & Rap', 83), ('%drill%', 'Hip-Hop & Rap', 84), ('%grime%', 'Hip-Hop & Rap', 85),
  ('%boom bap%', 'Hip-Hop & Rap', 86),
  ('%r&b%', 'R&B & Soul', 90), ('%rhythm and blues%', 'R&B & Soul', 91), ('%soul%', 'R&B & Soul', 92),
  ('%funk%', 'R&B & Soul', 93), ('%motown%', 'R&B & Soul', 94), ('%new jack swing%', 'R&B & Soul', 95),
  ('%gospel%', 'R&B & Soul', 96),
  ('%indie%', 'Indie & Alternative', 100), ('%alternative%', 'Indie & Alternative', 101),
  ('%shoegaze%', 'Indie & Alternative', 102), ('%dream pop%', 'Indie & Alternative', 103),
  ('%bedroom pop%', 'Indie & Alternative', 104), ('%post-punk%', 'Indie & Alternative', 105),
  ('%lo-fi%', 'Indie & Alternative', 106), ('%math rock%', 'Indie & Alternative', 107),
  ('%art pop%', 'Indie & Alternative', 108), ('%chamber pop%', 'Indie & Alternative', 109),
  ('%noise pop%', 'Indie & Alternative', 110), ('%post-rock%', 'Indie & Alternative', 111),
  ('%electro%', 'Electronic & Dance', 120), ('%house%', 'Electronic & Dance', 121), ('%techno%', 'Electronic & Dance', 122),
  ('%trance%', 'Electronic & Dance', 123), ('%edm%', 'Electronic & Dance', 124), ('%dance%', 'Electronic & Dance', 125),
  ('%dubstep%', 'Electronic & Dance', 126), ('%drum and bass%', 'Electronic & Dance', 127),
  ('%synth%', 'Electronic & Dance', 128), ('%disco%', 'Electronic & Dance', 129), ('%garage%', 'Electronic & Dance', 130),
  ('%ambient%', 'Electronic & Dance', 131), ('%downtempo%', 'Electronic & Dance', 132), ('%trip hop%', 'Electronic & Dance', 133),
  ('%hardstyle%', 'Electronic & Dance', 134), ('%big room%', 'Electronic & Dance', 135),
  ('%jazz%', 'Jazz & Blues', 140), ('%blues%', 'Jazz & Blues', 141), ('%swing%', 'Jazz & Blues', 142),
  ('%bebop%', 'Jazz & Blues', 143), ('%big band%', 'Jazz & Blues', 144), ('%ragtime%', 'Jazz & Blues', 145),
  ('%classical%', 'Classical', 150), ('%opera%', 'Classical', 151), ('%baroque%', 'Classical', 152),
  ('%symphon%', 'Classical', 153), ('%orchestra%', 'Classical', 154), ('%chamber music%', 'Classical', 155),
  ('%minimalis%', 'Classical', 156),
  ('%country%', 'Country & Folk', 160), ('%folk%', 'Country & Folk', 161), ('%bluegrass%', 'Country & Folk', 162),
  ('%americana%', 'Country & Folk', 163), ('%acoustic%', 'Country & Folk', 164),
  ('%punk%', 'Rock', 170), ('%rock%', 'Rock', 171),
  ('%pop%', 'Pop', 180)
on conflict (pattern) do nothing;

-- Readable to signed-in users (the app shows short labels); written only
-- by the team, from the dashboard or a migration.
alter table public.genre_buckets  enable row level security;
alter table public.genre_map      enable row level security;
alter table public.genre_patterns enable row level security;
create policy "Genre buckets are readable" on public.genre_buckets for select to authenticated using (true);
create policy "Genre map is readable" on public.genre_map for select to authenticated using (true);
create policy "Genre patterns are readable" on public.genre_patterns for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Mapping functions
-- ---------------------------------------------------------------------------

-- One raw genre to its bucket: exact name, then the first pattern, then Other.
create or replace function public.genre_bucket_of(p_raw text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select m.bucket from public.genre_map m where m.raw = lower(trim(p_raw))),
    (select p.bucket from public.genre_patterns p
      where lower(trim(p_raw)) like p.pattern
      order by p.priority limit 1),
    'Other'
  )
$$;

-- An artist's buckets, at most 2: the buckets most of their genres fall in,
-- ties by priority. 'Other' only when nothing else matched; no genres at
-- all gives an empty array.
create or replace function public.artist_genre_buckets(p_raw text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  with mapped as (
    select public.genre_bucket_of(g) as bucket from unnest(coalesce(p_raw, '{}')) as g
  ), ranked as (
    select m.bucket, count(*) as n, b.priority
      from mapped m join public.genre_buckets b on b.name = m.bucket
     group by m.bucket, b.priority
  )
  select coalesce(
    (select array_agg(bucket order by n desc, priority)
       from (select * from ranked where bucket <> 'Other' order by n desc, priority limit 2) r),
    (select array['Other'] from ranked limit 1),
    '{}'::text[]
  )
$$;

-- A computed field: GET /artists?select=*,genre_buckets
create or replace function public.genre_buckets(a public.artists)
returns text[]
language sql
stable
set search_path = ''
as $$
  select public.artist_genre_buckets(a.genres_raw)
$$;

-- Raw genres that fell through to Other, with how many artists have each:
-- the list to extend the mapping from. Not exposed to the app.
create or replace view public.genre_unmapped
with (security_invoker = true) as
  select lower(trim(g)) as raw, count(*) as artists
    from public.artists a, unnest(a.genres_raw) as g
   where public.genre_bucket_of(g) = 'Other'
     and not exists (select 1 from public.genre_map m where m.raw = lower(trim(g)) and m.bucket = 'Other')
   group by 1
   order by 2 desc, 1;
revoke all on public.genre_unmapped from anon, authenticated;

commit;
