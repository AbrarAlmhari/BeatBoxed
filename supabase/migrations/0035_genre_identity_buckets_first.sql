-- Refines 0034. Putting the four broad buckets above everything made a tie
-- between "K-pop" and "pop music" come out as Pop, so K-pop groups (ATEEZ,
-- BLACKPINK) lost K-Pop, and Arab artists lost Khaleeji to Pop or R&B.
--
-- Tie-break order now:
--   1. regional identity: Arabic, Khaleeji, K-Pop (South Asian joins in 0036)
--   2. the broad four: Pop, Hip-Hop & Rap, R&B & Soul, Rock
--   3. everything else, Latin included
-- So Michael Jackson stays "R&B & Soul · Pop" (his one samba tag no longer
-- wins a tie), and a K-pop group keeps K-Pop.
--
-- Only genre_buckets.priority changes. Undo with
-- supabase/rollbacks/0035_genre_identity_buckets_first_rollback.sql, which
-- puts 0034's order back.
begin;

update public.genre_buckets as b
   set priority = v.priority
  from (values
    ('Arabic',               5),
    ('Khaleeji',             6),
    ('K-Pop',                7)
  ) as v(name, priority)
 where b.name = v.name;

commit;
