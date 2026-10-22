-- Rebuilds the stored search text of songs whose text changes under the
-- current normalize_search_text(), 100 songs at a time. Run it repeatedly
-- (each run is its own short transaction) until it returns 0.
--
-- Used after migrations/0051 (any language), and the same script works
-- after its rollback: it always brings search_text in line with whatever
-- the function says now. Rows another session is busy with are skipped
-- this round and picked up by the next.
with batch as (
  select s.id
    from public.songs s
   where s.search_text is distinct from public.normalize_search_text(
           coalesce(s.title, '') || ' ' ||
           coalesce((select a.name from public.artists a where a.id = s.artist_id), '')
         )
   order by s.id
   limit 100
   for update of s skip locked
), done as (
  update public.songs s
     set search_text = public.normalize_search_text(
           coalesce(s.title, '') || ' ' ||
           coalesce((select a.name from public.artists a where a.id = s.artist_id), '')
         )
   where s.id in (select id from batch)
  returning 1
)
select count(*) as updated from done;
