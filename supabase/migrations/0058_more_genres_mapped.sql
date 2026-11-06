-- More raw genres mapped out of Other (0058). Each name below falls through
-- to Other today and is in the genre_unmapped view. Only adds rows to
-- genre_map: artists re-group on read, and nothing stored per artist changes.
-- Existing mappings are left alone. Undo with
-- supabase/rollbacks/0058_more_genres_mapped_rollback.sql.
begin;

set local lock_timeout = '5s';

insert into public.genre_map (raw, bucket) values
  ('happy hardcore', 'Electronic & Dance'),
  ('frenchcore', 'Electronic & Dance'),
  ('uptempo hardcore', 'Electronic & Dance'),
  ('chillwave', 'Electronic & Dance'),
  ('future bass', 'Electronic & Dance'),
  ('bass music', 'Electronic & Dance'),
  ('chiptune', 'Electronic & Dance'),
  ('brazilian bass', 'Electronic & Dance'),
  ('amapiano', 'Electronic & Dance'),
  ('rage', 'Hip-Hop & Rap'),
  ('dirty south', 'Hip-Hop & Rap'),
  ('horrorcore', 'Hip-Hop & Rap'),
  ('crunk', 'Hip-Hop & Rap'),
  ('bounce music', 'Hip-Hop & Rap'),
  ('digicore', 'Hip-Hop & Rap'),
  ('afro fusion', 'Hip-Hop & Rap'),
  ('urban contemporary', 'R&B & Soul'),
  ('boogie', 'R&B & Soul'),
  ('post-grunge', 'Rock'),
  ('post-hardcore', 'Rock'),
  ('psychedelic music', 'Rock'),
  ('neo-psychedelia', 'Indie & Alternative'),
  ('slowcore', 'Indie & Alternative'),
  ('ethereal wave', 'Indie & Alternative'),
  ('djent', 'Metal'),
  ('ballad', 'Pop'),
  ('schlager music', 'Pop'),
  ('bubblegum music', 'Pop'),
  ('easy listening', 'Pop'),
  ('chanson', 'Pop'),
  ('anime song', 'Pop'),
  ('boogie-woogie', 'Jazz & Blues'),
  ('singer-songwriter music', 'Country & Folk')
on conflict (raw) do nothing;

commit;
