-- Two genre names that the '%k-pop%' pattern caught by accident:
-- "fol(k-pop)" and "pun(k-pop)". Patterns tried before it (lower priority
-- numbers) send them to the right buckets. Only adds rows.
-- Undo with supabase/rollbacks/0033_genre_mapping_fixes_rollback.sql.
begin;

insert into public.genre_patterns (pattern, bucket, priority) values
  ('%folk-pop%', 'Country & Folk', 5),
  ('%punk-pop%', 'Rock', 6)
on conflict (pattern) do nothing;

commit;
