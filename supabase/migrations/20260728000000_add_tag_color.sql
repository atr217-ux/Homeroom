-- Custom color override on tags. Null falls back to name-derived color in
-- the client, so nothing changes for tags the user hasn't recolored.

alter table tags add column if not exists color text;
