-- Undoes migrations/0034_genre_tie_breaks.sql: puts 0031's priorities back.
-- Run by hand only. Lost: nothing but the new order.
begin;

update public.genre_buckets as b
   set priority = v.priority
  from (values
    ('Arabic', 10), ('Khaleeji', 20), ('K-Pop', 30), ('Latin', 40),
    ('Hip-Hop & Rap', 50), ('R&B & Soul', 60), ('Metal', 70),
    ('Indie & Alternative', 80), ('Electronic & Dance', 90), ('Jazz & Blues', 100),
    ('Classical', 110), ('Country & Folk', 120), ('Rock', 130), ('Pop', 140),
    ('Other', 999)
  ) as v(name, priority)
 where b.name = v.name;

commit;
