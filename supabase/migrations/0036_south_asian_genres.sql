-- A "South Asian" genre bucket: Indian film music and Bollywood, filmi,
-- Carnatic and Hindustani classical, Punjabi and bhangra, Tamil, Telugu and
-- other regional cinema music, ghazal, qawwali, bhajan and similar. These
-- were the most common raw genres falling through to Other.
--
-- Its patterns are tried first (priority 1), so "punjabi pop" or "indian
-- rock" are South Asian rather than Pop or Rock, and in a tie it ranks with
-- the other regional identity buckets (after K-Pop, before the broad four).
--
-- Only adds rows: one bucket and its patterns. Every artist re-groups at
-- once (buckets are worked out on read). Undo with
-- supabase/rollbacks/0036_south_asian_genres_rollback.sql.
begin;

insert into public.genre_buckets (name, short_label, priority)
values ('South Asian', 'South Asian', 8)
on conflict (name) do nothing;

insert into public.genre_patterns (pattern, bucket, priority) values
  ('%indian%', 'South Asian', 1), ('%bollywood%', 'South Asian', 1), ('%filmi%', 'South Asian', 1),
  ('%carnatic%', 'South Asian', 1), ('%hindustani%', 'South Asian', 1), ('%punjabi%', 'South Asian', 1),
  ('%bhangra%', 'South Asian', 1), ('%tamil%', 'South Asian', 1), ('%telugu%', 'South Asian', 1),
  ('%kannada%', 'South Asian', 1), ('%malayalam%', 'South Asian', 1), ('%kollywood%', 'South Asian', 1),
  ('%tollywood%', 'South Asian', 1), ('%lollywood%', 'South Asian', 1), ('%ghazal%', 'South Asian', 1),
  ('%qawwali%', 'South Asian', 1), ('%bhajan%', 'South Asian', 1), ('%kirtan%', 'South Asian', 1),
  ('%desi%', 'South Asian', 1), ('%pakistani%', 'South Asian', 1), ('%bengali%', 'South Asian', 1),
  ('%marathi%', 'South Asian', 1), ('%gujarati%', 'South Asian', 1), ('%bhojpuri%', 'South Asian', 1),
  ('%haryanvi%', 'South Asian', 1), ('%rabindra%', 'South Asian', 1), ('%thumri%', 'South Asian', 1),
  ('%sufi%', 'South Asian', 1), ('%nepali%', 'South Asian', 1), ('%sri lanka%', 'South Asian', 1),
  ('%sinhala%', 'South Asian', 1), ('%baila%', 'South Asian', 1)
on conflict (pattern) do nothing;

-- 0031 sent these exact names to Other; the exact map wins over patterns,
-- so without this they'd stay Other.
insert into public.genre_map (raw, bucket) values
  ('bollywood', 'South Asian'), ('filmi', 'South Asian')
on conflict (raw) do update set bucket = excluded.bucket
  where public.genre_map.bucket = 'Other';

commit;
