-- User-level settings on the profile row itself.

alter table profiles
  add column if not exists auto_private_tasks boolean not null default false,
  add column if not exists searchable         boolean not null default true;

create index if not exists profiles_searchable_idx on profiles(searchable) where searchable = true;
