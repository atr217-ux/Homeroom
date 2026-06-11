-- The "Invited users can view shared blocks" policy on blocks queries block_invites
-- directly as the authenticated user, triggering a GRANT check that fails.
-- Wrap it in a SECURITY DEFINER function so it runs as the function owner (postgres),
-- bypassing both the GRANT check and block_invites RLS.

CREATE OR REPLACE FUNCTION user_has_block_invite(bid uuid, uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM block_invites
    WHERE block_invites.block_id = bid
      AND block_invites.invited_user_id = uid
      AND block_invites.status IN ('invited', 'joined')
  );
$$;

DROP POLICY IF EXISTS "Invited users can view shared blocks" ON blocks;

CREATE POLICY "Invited users can view shared blocks"
  ON blocks FOR SELECT
  USING (
    visibility = 'shared' AND user_has_block_invite(id, auth.uid())
  );

-- Ensure authenticated users have table-level grants (belt-and-suspenders)
GRANT SELECT, INSERT, UPDATE, DELETE ON blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON block_invites TO authenticated;
