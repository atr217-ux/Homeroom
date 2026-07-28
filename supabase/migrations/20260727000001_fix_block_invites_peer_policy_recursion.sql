-- Fix infinite recursion in the peer-visibility policy on block_invites.
-- The previous policy did `select 1 from block_invites` inside its own
-- USING clause, which re-triggers RLS on the same table → 42P17.
-- Reuse the existing SECURITY DEFINER helper `user_has_block_invite` so
-- the peer check bypasses RLS on block_invites and doesn't recurse.

drop policy if exists "Invitees see peers on their blocks" on block_invites;
create policy "Invitees see peers on their blocks"
  on block_invites for select
  using (user_has_block_invite(block_id, auth.uid()));
