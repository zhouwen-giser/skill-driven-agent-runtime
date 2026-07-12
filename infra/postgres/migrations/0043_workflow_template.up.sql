BEGIN;

CREATE TABLE IF NOT EXISTS workflow_template_occurrence (
  experience_id text PRIMARY KEY REFERENCES evolution_experience(experience_id),
  goal_key text NOT NULL,
  structure_key text NOT NULL,
  workflow_json jsonb NOT NULL,
  duration_ms double precision NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_template_occurrence_pattern_idx
  ON workflow_template_occurrence(goal_key, structure_key, created_at, experience_id);

CREATE TABLE IF NOT EXISTS workflow_template (
  template_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  goal_key text NOT NULL,
  structure_key text NOT NULL,
  workflow_json jsonb NOT NULL,
  source_experience_ids_json jsonb NOT NULL,
  source_success_count integer NOT NULL CHECK (source_success_count >= 3),
  use_count integer NOT NULL CHECK (use_count >= 0),
  successful_use_count integer NOT NULL CHECK (successful_use_count BETWEEN 0 AND use_count),
  average_use_duration_ms double precision NOT NULL CHECK (average_use_duration_ms >= 0),
  status text NOT NULL CHECK (status = 'enabled'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (template_id, version)
);

CREATE INDEX IF NOT EXISTS workflow_template_goal_version_idx
  ON workflow_template(goal_key, version DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_template_use (
  use_id text PRIMARY KEY,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  workflow_definition_id text NOT NULL,
  workflow_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'succeeded', 'failed')),
  duration_ms double precision CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (template_id, template_version) REFERENCES workflow_template(template_id, version),
  UNIQUE (workflow_definition_id, workflow_version)
);

COMMIT;
