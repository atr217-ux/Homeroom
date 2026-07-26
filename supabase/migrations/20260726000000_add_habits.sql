-- Habit tracker — per-user list of daily habits, each with a set of dates
-- the user has checked off. RLS keeps everything scoped to the owning
-- user via the habits row.

create table if not exists habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists habits_user_idx on habits(user_id, sort_order);

alter table habits enable row level security;

drop policy if exists "Users manage own habits" on habits;
create policy "Users manage own habits"
  on habits for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on habits to authenticated;

create table if not exists habit_completions (
  habit_id   uuid not null references habits(id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, date)
);

create index if not exists habit_completions_date_idx on habit_completions(habit_id, date);

alter table habit_completions enable row level security;

-- Completions inherit visibility + write permissions from the parent habit.
drop policy if exists "Users manage own habit completions" on habit_completions;
create policy "Users manage own habit completions"
  on habit_completions for all
  using (
    exists (select 1 from habits where habits.id = habit_completions.habit_id and habits.user_id = auth.uid())
  )
  with check (
    exists (select 1 from habits where habits.id = habit_completions.habit_id and habits.user_id = auth.uid())
  );

grant select, insert, update, delete on habit_completions to authenticated;
