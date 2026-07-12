BEGIN;

CREATE TABLE IF NOT EXISTS skill_evolution_correction_experience (
  correction_id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES skill_formalization_candidate(candidate_id),
  capability_fingerprint text NOT NULL,
  actor text NOT NULL CHECK (length(trim(actor)) > 0),
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  before_skill_json jsonb NOT NULL,
  after_skill_json jsonb NOT NULL,
  diff_json jsonb NOT NULL,
  validation_report_json jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('validation_failed', 'published')),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS skill_evolution_correction_candidate_idx
  ON skill_evolution_correction_experience(candidate_id, created_at, correction_id);

CREATE INDEX IF NOT EXISTS skill_evolution_correction_capability_idx
  ON skill_evolution_correction_experience(capability_fingerprint, created_at, correction_id);

COMMIT;
