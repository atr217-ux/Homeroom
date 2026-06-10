-- Add timer tracking columns to tasks if they don't already exist
alter table tasks
  add column if not exists time_spent        integer not null default 0,
  add column if not exists timer_started_at  timestamptz;
