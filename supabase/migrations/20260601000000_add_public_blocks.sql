-- Allow 'public' as a visibility value on blocks
DO $$ BEGIN
  ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_visibility_check;
  ALTER TABLE blocks ADD CONSTRAINT blocks_visibility_check
    CHECK (visibility IN ('private', 'shared', 'public'));
END $$;

-- Any authenticated user can view public blocks
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='blocks' AND policyname='Anyone can view public blocks'
  ) THEN
    EXECUTE 'CREATE POLICY "Anyone can view public blocks" ON blocks FOR SELECT USING (visibility = ''public'')';
  END IF;
END $$;
