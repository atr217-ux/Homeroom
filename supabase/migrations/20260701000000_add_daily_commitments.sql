-- ── Daily commitments ──────────────────────────────────────────────────────
-- One-sentence intention/focus the user declares for a given day. Optional.

create table if not exists daily_commitments (
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  commitment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists daily_commitments_date_idx on daily_commitments(date);

alter table daily_commitments enable row level security;

drop policy if exists "Users manage own daily commitments" on daily_commitments;
create policy "Users manage own daily commitments"
  on daily_commitments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Friends see non-empty commitments" on daily_commitments;
create policy "Friends see non-empty commitments"
  on daily_commitments for select
  using (
    length(commitment) > 0
    and are_friends(auth.uid(), user_id)
  );

grant select, insert, update, delete on daily_commitments to authenticated;
