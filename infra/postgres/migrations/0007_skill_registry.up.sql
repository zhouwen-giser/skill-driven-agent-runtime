BEGIN;
CREATE TABLE IF NOT EXISTS skill (
  skill_id text PRIMARY KEY,
  current_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_version (
  skill_id text NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  summary text NOT NULL,
  description text NOT NULL,
  capabilities_json jsonb NOT NULL,
  workflow_guidance text NOT NULL,
  output_instruction text NOT NULL,
  input_schema_json jsonb NOT NULL,
  output_schema_json jsonb NOT NULL,
  tool_policy_json jsonb NOT NULL,
  runtime_policy_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','validating','enabled','disabled','deprecated','validation_failed')),
  source_kind text NOT NULL CHECK (source_kind IN ('admin','a2a_draft','experience_evolution','manual_correction')),
  validation_passed boolean NOT NULL,
  previous_version integer,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (skill_id, version),
  FOREIGN KEY (skill_id, previous_version) REFERENCES skill_version(skill_id, version)
);
CREATE INDEX IF NOT EXISTS skill_version_enabled ON skill_version (status, skill_id, version);
INSERT INTO schema_migration (version) VALUES ('0007_skill_registry') ON CONFLICT (version) DO NOTHING;
COMMIT;
