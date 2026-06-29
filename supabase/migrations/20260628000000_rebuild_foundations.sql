-- ── Rebuild foundations ──────────────────────────────────────────────────────
-- Adds task privacy, today-commitment marker, and a clean friendships table
-- with the RLS expansion needed to let friends see each other's non-private tasks.

-- 1. Task privacy flag
alter table tasks add column if not exists is_private boolean not null default false;
create index if not exists tasks_user_private_idx on tasks(user_id, is_private);

-- 2. Today commitment marker (which day the user "committed to" this task)
alter table tasks add column if not exists committed_for_date date;
create index if not exists tasks_committed_for_date_idx on tasks(committed_for_date)
  where committed_for_date is not null;

-- 3. Clean friendships table — populated when a friend_requests row is accepted.
--    Canonical ordering (user_a < user_b) prevents duplicate (a,b)+(b,a) pairs.
create table if not exists friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

alter table friendships enable row level security;

drop policy if exists "Users see their own friendships" on friendships;
create policy "Users see their own friendships"
  on friendships for select
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Authenticated insert friendship" on friendships;
create policy "Authenticated insert friendship"
  on friendships for insert
  with check (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Either party can delete friendship" on friendships;
create policy "Either party can delete friendship"
  on friendships for delete
  using (auth.uid() = user_a or auth.uid() = user_b);

grant select, insert, delete on friendships to authenticated;

-- 4. Helper: SECURITY DEFINER so RLS policies can call it without recursion
create or replace function are_friends(a uuid, b uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from friendships
    where user_a = least(a, b) and user_b = greatest(a, b)
  );
$$;

grant execute on function are_friends(uuid, uuid) to authenticated;

-- 5. Expand tasks SELECT — friends can read non-private tasks.
--    Additive: existing "user owns task" policy continues to work via OR semantics.
drop policy if exists "Friends see non-private tasks" on tasks;
create policy "Friends see non-private tasks"
  on tasks for select
  using (is_private = false and are_friends(auth.uid(), user_id));

-- 6. Expand profiles SELECT so feed/friend cards can render friend usernames+avatars.
drop policy if exists "Friends see profile" on profiles;
create policy "Friends see profile"
  on profiles for select
  using (id = auth.uid() or are_friends(auth.uid(), id));
