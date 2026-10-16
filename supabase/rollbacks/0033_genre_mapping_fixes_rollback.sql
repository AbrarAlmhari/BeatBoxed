-- Undoes migrations/0033_genre_mapping_fixes.sql. Run by hand only.
-- Lost: nothing but these two mapping rows.
begin;
delete from public.genre_patterns where pattern in ('%folk-pop%', '%punk-pop%');
commit;
