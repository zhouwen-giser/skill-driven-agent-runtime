BEGIN;

ALTER TABLE skill_draft
  DROP CONSTRAINT IF EXISTS skill_draft_status_check,
  DROP CONSTRAINT IF EXISTS skill_draft_publication_check;

ALTER TABLE skill_draft
  ADD COLUMN IF NOT EXISTS published_skill_id text,
  ADD COLUMN IF NOT EXISTS published_skill_version integer,
  ADD COLUMN IF NOT EXISTS published_by text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD CONSTRAINT skill_draft_status_check CHECK (status IN ('draft', 'published')),
  ADD CONSTRAINT skill_draft_publication_check CHECK (
    (status = 'draft' AND published_skill_id IS NULL AND published_skill_version IS NULL
      AND published_by IS NULL AND published_at IS NULL)
    OR
    (status = 'published' AND published_skill_id IS NOT NULL AND published_skill_version IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL)
  );

COMMIT;
