-- Undoes migrations/0035_genre_identity_buckets_first.sql: 0034's order.
-- Run by hand only. Lost: nothing but the order.
begin;

update public.genre_buckets as b
   set priority = v.priority
  from (values ('Arabic', 50), ('Khaleeji', 60), ('K-Pop', 70)) as v(name, priority)
 where b.name = v.name;

commit;
