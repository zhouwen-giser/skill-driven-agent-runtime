BEGIN;

ALTER TABLE skill_draft
  DROP CONSTRAINT IF EXISTS skill_draft_publication_check,
  DROP CONSTRAINT IF EXISTS skill_draft_status_check,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS published_skill_version,
  DROP COLUMN IF EXISTS published_skill_id,
  ADD CONSTRAINT skill_draft_status_check CHECK (status = 'draft');

COMMIT;
