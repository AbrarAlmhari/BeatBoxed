-- Undoes migrations/0058_more_genres_mapped.sql. Run by hand only.
-- Lost: nothing but these mapping rows; artists re-group back on read.
begin;

set local lock_timeout = '5s';

delete from public.genre_map where raw in (
  'happy hardcore', 'frenchcore', 'uptempo hardcore', 'chillwave', 'future bass', 'bass music',
  'chiptune', 'brazilian bass', 'amapiano',
  'rage', 'dirty south', 'horrorcore', 'crunk', 'bounce music', 'digicore', 'afro fusion',
  'urban contemporary', 'boogie',
  'post-grunge', 'post-hardcore', 'psychedelic music', 'neo-psychedelia', 'slowcore', 'ethereal wave', 'djent',
  'ballad', 'schlager music', 'bubblegum music', 'easy listening', 'chanson', 'anime song',
  'boogie-woogie', 'singer-songwriter music'
);

commit;
