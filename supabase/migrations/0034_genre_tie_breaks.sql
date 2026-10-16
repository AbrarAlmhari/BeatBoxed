-- Genre tie-breaks: when an artist's genres split evenly between buckets,
-- the broad ones now win: Pop, Hip-Hop & Rap, R&B & Soul, then Rock, ahead
-- of the regional and niche buckets. Before this, Latin (and the other
-- regional buckets) came first, so one "samba" tag made Michael Jackson
-- "R&B & Soul · Latin".
--
-- Ties only: an artist whose genres are mostly Arabic (or Latin, or
-- anything else) still gets that bucket first, because the bucket with the
-- most of their genres always wins before priority is looked at.
--
-- Buckets aren't stored per artist (artist_genre_buckets() reads this table
-- every time), so this re-groups every artist at once. Only the priority
-- column of genre_buckets changes; no user data is touched.
-- Undo with supabase/rollbacks/0034_genre_tie_breaks_rollback.sql.
begin;

update public.genre_buckets as b
   set priority = v.priority
  from (values
    ('Pop',                 10),
    ('Hip-Hop & Rap',       20),
    ('R&B & Soul',          30),
    ('Rock',                40),
    ('Arabic',              50),
    ('Khaleeji',            60),
    ('K-Pop',               70),
    ('Indie & Alternative', 80),
    ('Electronic & Dance',  90),
    ('Metal',              100),
    ('Jazz & Blues',       110),
    ('Classical',          120),
    ('Country & Folk',     130),
    ('Latin',              140),
    ('Other',              999)
  ) as v(name, priority)
 where b.name = v.name;

commit;
