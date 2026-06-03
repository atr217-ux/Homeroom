-- ── Blocks ───────────────────────────────────────────────────────────────────

create table if not exists blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  name         text not null default 'Today',
  start_time   time,
  end_time     time,
  visibility   text not null default 'private' check (visibility in ('private', 'shared')),
  is_live      boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists blocks_user_date on blocks(user_id, date);

alter table blocks enable row level security;

create policy "Users manage own blocks"
  on blocks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── Block Invites ─────────────────────────────────────────────────────────────
-- Must be created before the blocks policy that references it

create table if not exists block_invites (
  id                uuid primary key default gen_random_uuid(),
  block_id          uuid not null references blocks(id) on delete cascade,
  invited_user_id   uuid not null references auth.users(id) on delete cascade,
  status            text not null default 'invited' check (status in ('invited', 'joined', 'declined')),
  created_at        timestamptz not null default now(),
  unique (block_id, invited_user_id)
);

create index if not exists block_invites_user on block_invites(invited_user_id);

alter table block_invites enable row level security;

create policy "Block owner manages invites"
  on block_invites for all
  using (
    exists (select 1 from blocks where blocks.id = block_invites.block_id and blocks.user_id = auth.uid())
  )
  with check (
    exists (select 1 from blocks where blocks.id = block_invites.block_id and blocks.user_id = auth.uid())
  );

create policy "Invited user can view and update own invite"
  on block_invites for all
  using (invited_user_id = auth.uid())
  with check (invited_user_id = auth.uid());


-- ── blocks — RLS policy that references block_invites (added after that table exists)

create policy "Invited users can view shared blocks"
  on blocks for select
  using (
    visibility = 'shared' and exists (
      select 1 from block_invites
      where block_invites.block_id = blocks.id
        and block_invites.invited_user_id = auth.uid()
        and block_invites.status in ('invited', 'joined')
    )
  );


-- ── Tasks — add block_id and shared-task fields ───────────────────────────────

alter table tasks
  add column if not exists block_id             uuid references blocks(id) on delete set null,
  add column if not exists is_shared            boolean not null default false,
  add column if not exists claimed_by_user_id   uuid references auth.users(id) on delete set null,
  add column if not exists completed_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists tasks_block_id on tasks(block_id) where block_id is not null;
