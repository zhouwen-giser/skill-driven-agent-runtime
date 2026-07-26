BEGIN;

ALTER TABLE capability_pattern_definition
  ADD COLUMN capability_id text,
  ADD COLUMN fingerprint text CHECK (
    fingerprint IS NULL OR fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN definition_origin text NOT NULL DEFAULT 'reflection_candidate'
    CHECK (
      definition_origin IN (
        'reflection_candidate',
        'capability_pattern_induction',
        'fixture'
      )
    ),
  ADD COLUMN model_invocation_id text REFERENCES model_invocation(invocation_id);

CREATE INDEX capability_pattern_definition_identity_idx
  ON capability_pattern_definition(capability_id, revision DESC, knowledge_id)
  WHERE capability_id IS NOT NULL;

CREATE INDEX capability_pattern_definition_active_catalog_idx
  ON capability_pattern_definition(status, catalog_hash, capability_id)
  WHERE status = 'active';

CREATE TABLE capability_gap_candidate (
  gap_id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('candidate', 'rejected', 'converted')),
  capability_id text NOT NULL,
  pattern_id text NOT NULL,
  pattern_revision integer NOT NULL CHECK (pattern_revision >= 1),
  catalog_hash text NOT NULL CHECK (catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (pattern_id, pattern_revision)
    REFERENCES capability_pattern_definition(knowledge_id, revision)
);

CREATE INDEX capability_gap_candidate_capability_idx
  ON capability_gap_candidate(capability_id, created_at DESC);

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection', 'task_type_induction',
  'capability_pattern_induction'
));

INSERT INTO schema_migration(version)
VALUES ('0119_v123_capability_pattern_induction');

COMMIT;
