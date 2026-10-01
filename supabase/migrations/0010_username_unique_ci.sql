-- Case-insensitive usernames.
--
-- profiles.username already has a unique constraint, but it is case-sensitive:
-- verified that inserting "FARA7" alongside an existing "fara7" gets past the
-- uniqueness check. Two accounts could differ only by capitalisation, which
-- makes @mentions and people-search ambiguous.
--
-- Existing usernames are all lowercase and distinct, so this index can be
-- created without cleaning up collisions first.

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;
