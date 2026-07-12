BEGIN;

ALTER TABLE skill_formalization_candidate
  DROP CONSTRAINT IF EXISTS skill_formalization_candidate_status_check,
  DROP CONSTRAINT IF EXISTS skill_formalization_candidate_publication_check;

ALTER TABLE skill_formalization_candidate
  ADD COLUMN IF NOT EXISTS induction_report_json jsonb,
  ADD COLUMN IF NOT EXISTS validation_report_json jsonb,
  ADD COLUMN IF NOT EXISTS proposed_skill_json jsonb,
  ADD COLUMN IF NOT EXISTS published_skill_id text,
  ADD COLUMN IF NOT EXISTS published_skill_version integer,
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
  ADD CONSTRAINT skill_formalization_candidate_status_check
    CHECK (status IN ('awaiting_simulation', 'validation_failed', 'published')),
  ADD CONSTRAINT skill_formalization_candidate_publication_check CHECK (
    (status = 'published' AND published_skill_id IS NOT NULL AND published_skill_version IS NOT NULL)
    OR
    (status <> 'published' AND published_skill_id IS NULL AND published_skill_version IS NULL)
  );

COMMIT;
