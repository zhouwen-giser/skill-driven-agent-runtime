BEGIN;

ALTER TABLE skill_formalization_candidate
  DROP CONSTRAINT IF EXISTS skill_formalization_candidate_publication_check,
  DROP CONSTRAINT IF EXISTS skill_formalization_candidate_status_check,
  DROP COLUMN IF EXISTS induction_report_json,
  DROP COLUMN IF EXISTS validation_report_json,
  DROP COLUMN IF EXISTS proposed_skill_json,
  DROP COLUMN IF EXISTS published_skill_id,
  DROP COLUMN IF EXISTS published_skill_version,
  DROP COLUMN IF EXISTS evaluated_at,
  ADD CONSTRAINT skill_formalization_candidate_status_check CHECK (status = 'awaiting_simulation');

COMMIT;
