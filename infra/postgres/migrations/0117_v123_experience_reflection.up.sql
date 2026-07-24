BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_reflection) THEN
    RAISE EXCEPTION 'MIGRATION_0117_REQUIRES_EMPTY_UNRELEASED_REFLECTION_DATA';
  END IF;
END $$;

ALTER TABLE experience_reflection
  ADD COLUMN observation_ids jsonb NOT NULL CHECK (
    jsonb_typeof(observation_ids) = 'array'
    AND jsonb_array_length(observation_ids) BETWEEN 1 AND 100
  ),
  ADD COLUMN group_key jsonb NOT NULL CHECK (jsonb_typeof(group_key) = 'object'),
  ADD COLUMN impacts jsonb NOT NULL CHECK (jsonb_typeof(impacts) = 'array'),
  ADD COLUMN reflection_hash text NOT NULL UNIQUE CHECK (
    reflection_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN model_invocation_refs jsonb NOT NULL CHECK (
    jsonb_typeof(model_invocation_refs) = 'array'
  ),
  ADD CONSTRAINT experience_reflection_primary_model_fk
    FOREIGN KEY (model_invocation_id) REFERENCES model_invocation(invocation_id),
  ADD CONSTRAINT experience_reflection_delta_array_check CHECK (jsonb_typeof(delta) = 'array');

CREATE INDEX experience_reflection_created_idx
  ON experience_reflection(created_at DESC, reflection_id);
CREATE INDEX experience_reflection_observations_idx
  ON experience_reflection USING gin(observation_ids);

CREATE TABLE knowledge_delta_record (
  delta_id text PRIMARY KEY,
  reflection_id text NOT NULL REFERENCES experience_reflection(reflection_id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN (
    'CREATE_REVISION', 'SUGGEST_MERGE', 'SUGGEST_SUPERSEDE',
    'ADD_EVIDENCE', 'ADD_CONTRADICTION', 'NO_CHANGE'
  )),
  knowledge_kind text NOT NULL CHECK (
    knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')
  ),
  target_knowledge_id text,
  target_revision integer CHECK (target_revision IS NULL OR target_revision >= 1),
  candidate_knowledge_id text,
  candidate_revision integer CHECK (candidate_revision IS NULL OR candidate_revision >= 1),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  delta jsonb NOT NULL CHECK (jsonb_typeof(delta) = 'object'),
  model_invocation_id text REFERENCES model_invocation(invocation_id),
  created_at timestamptz NOT NULL,
  CHECK ((target_knowledge_id IS NULL) = (target_revision IS NULL)),
  CHECK ((candidate_knowledge_id IS NULL) = (candidate_revision IS NULL))
);

CREATE INDEX knowledge_delta_reflection_idx
  ON knowledge_delta_record(reflection_id, created_at, delta_id);
CREATE INDEX knowledge_delta_fingerprint_idx
  ON knowledge_delta_record(knowledge_kind, fingerprint, created_at DESC);

CREATE TABLE knowledge_candidate_lineage (
  knowledge_kind text NOT NULL CHECK (
    knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')
  ),
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL CHECK (knowledge_revision >= 1),
  reflection_id text NOT NULL REFERENCES experience_reflection(reflection_id),
  delta_id text NOT NULL UNIQUE REFERENCES knowledge_delta_record(delta_id),
  operation text NOT NULL CHECK (operation IN (
    'CREATE_REVISION', 'ADD_EVIDENCE', 'ADD_CONTRADICTION'
  )),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  identity jsonb NOT NULL CHECK (jsonb_typeof(identity) = 'object'),
  parent_refs jsonb NOT NULL CHECK (jsonb_typeof(parent_refs) = 'array'),
  related_refs jsonb NOT NULL CHECK (jsonb_typeof(related_refs) = 'array'),
  model_invocation_refs jsonb NOT NULL CHECK (jsonb_typeof(model_invocation_refs) = 'array'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_kind, knowledge_id, knowledge_revision)
);

CREATE INDEX knowledge_candidate_identity_idx
  ON knowledge_candidate_lineage(knowledge_kind, fingerprint, created_at DESC);

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection'
));

INSERT INTO schema_migration(version) VALUES ('0117_v123_experience_reflection');

COMMIT;
