BEGIN;

CREATE TABLE IF NOT EXISTS temporary_skill (
  temporary_skill_id text PRIMARY KEY,
  task_id text NOT NULL,
  context_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  tools_json jsonb NOT NULL,
  input_schema_json jsonb NOT NULL,
  output_schema_json jsonb NOT NULL,
  capability_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired')),
  created_at timestamptz NOT NULL,
  expired_at timestamptz,
  CHECK ((status = 'active' AND expired_at IS NULL) OR (status = 'expired' AND expired_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS temporary_skill_task_idx ON temporary_skill(task_id, status);

CREATE TABLE IF NOT EXISTS temporary_skill_experience (
  experience_id text PRIMARY KEY,
  temporary_skill_id text NOT NULL REFERENCES temporary_skill(temporary_skill_id),
  task_id text NOT NULL,
  context_id text NOT NULL,
  capability_fingerprint text NOT NULL,
  successful boolean NOT NULL,
  outcome_summary text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS temporary_skill_experience_fingerprint_idx
  ON temporary_skill_experience(capability_fingerprint, successful, created_at);

CREATE TABLE IF NOT EXISTS skill_formalization_candidate (
  candidate_id text PRIMARY KEY,
  capability_fingerprint text NOT NULL UNIQUE,
  successful_experience_count integer NOT NULL CHECK (successful_experience_count >= 2),
  required_success_threshold integer NOT NULL CHECK (required_success_threshold >= 2),
  source_experience_ids_json jsonb NOT NULL,
  status text NOT NULL CHECK (status = 'awaiting_simulation'),
  created_at timestamptz NOT NULL
);

COMMIT;
