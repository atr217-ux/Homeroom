-- Fix infinite recursion: blocks policy references block_invites,
-- block_invites policy references blocks → circular loop on INSERT...RETURNING.
-- Drop the circular policy and replace with a security-definer function
-- so the block_invites lookup bypasses RLS when checking block ownership.

DROP POLICY IF EXISTS "Invited users can view shared blocks" ON blocks;
DROP POLICY IF EXISTS "Block owner manages invites" ON block_invites;

-- Helper that reads block owner without triggering blocks RLS
CREATE OR REPLACE FUNCTION get_block_owner_id(bid uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT user_id FROM blocks WHERE id = bid;
$$;

-- Recreate block_invites ownership policy using the definer function (no recursion)
CREATE POLICY "Block owner manages invites"
  ON block_invites FOR ALL
  USING  (get_block_owner_id(block_id) = auth.uid())
  WITH CHECK (get_block_owner_id(block_id) = auth.uid());

-- Recreate the blocks invited-user policy using the definer function
CREATE POLICY "Invited users can view shared blocks"
  ON blocks FOR SELECT
  USING (
    visibility = 'shared' AND EXISTS (
      SELECT 1 FROM block_invites
      WHERE block_invites.block_id = blocks.id
        AND block_invites.invited_user_id = auth.uid()
        AND block_invites.status IN ('invited', 'joined')
    )
  );
