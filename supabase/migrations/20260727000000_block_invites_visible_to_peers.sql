-- Invitees can see the rest of the invite list for blocks they're invited
-- to, so the /home invite card can render "Who's in" with each person's
-- accept/decline status. Previously only the host or the owner of a row
-- could SELECT it, which made the peer list appear empty.

drop policy if exists "Invitees see peers on their blocks" on block_invites;
create policy "Invitees see peers on their blocks"
  on block_invites for select
  using (
    exists (
      select 1 from block_invites me
      where me.block_id = block_invites.block_id
        and me.invited_user_id = auth.uid()
        and me.status in ('invited', 'joined')
    )
  );
