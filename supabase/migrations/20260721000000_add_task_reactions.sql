-- Task reactions — lightweight social layer for co-working blocks.
-- Anyone who can see a task (owner, friend, block participant via existing
-- tasks RLS) can react to it with an emoji. Each user can add multiple
-- distinct emojis to the same task but not duplicate one.

create table if not exists task_reactions (
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id, emoji)
);

create index if not exists task_reactions_task_idx on task_reactions(task_id);
create index if not exists task_reactions_user_idx on task_reactions(user_id);

alter table task_reactions enable row level security;

-- SELECT: piggyback on tasks RLS — if the current user can see the task row
-- itself, they can see reactions on it.
drop policy if exists "See reactions on visible tasks" on task_reactions;
create policy "See reactions on visible tasks"
  on task_reactions for select
  using (
    exists (select 1 from tasks where tasks.id = task_reactions.task_id)
  );

-- INSERT: users can only insert their own reactions, and only on tasks
-- they can see.
drop policy if exists "Insert own reactions" on task_reactions;
create policy "Insert own reactions"
  on task_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from tasks where tasks.id = task_reactions.task_id)
  );

-- DELETE: users can only remove their own reactions.
drop policy if exists "Delete own reactions" on task_reactions;
create policy "Delete own reactions"
  on task_reactions for delete
  using (auth.uid() = user_id);

grant select, insert, delete on task_reactions to authenticated;

-- Ensure realtime broadcasts inserts/deletes so participants see reactions
-- land live in a running block.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'task_reactions'
  ) then
    alter publication supabase_realtime add table task_reactions;
  end if;
end
$$;
