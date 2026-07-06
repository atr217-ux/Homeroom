-- Free-form daily notes stored alongside the daily commitment (one row per user per day).

alter table daily_commitments
  add column if not exists notes text not null default '';
