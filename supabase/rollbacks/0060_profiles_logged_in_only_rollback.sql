-- Undoes 0060: profiles and mention_people are open to logged-out visitors again.
begin;
alter policy "Profiles are viewable by logged-in users" on public.profiles rename to "Profiles are viewable by everyone";
alter policy "Profiles are viewable by everyone" on public.profiles to public;
grant execute on function public.mention_people(text) to anon;
commit;
