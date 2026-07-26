BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_observation)
     OR EXISTS (SELECT 1 FROM experience_observation_fact)
     OR EXISTS (SELECT 1 FROM experience_extraction)
     OR EXISTS (SELECT 1 FROM experience_reflection) THEN
    RAISE EXCEPTION 'MIGRATION_0116_REQUIRES_EMPTY_UNRELEASED_OBSERVATION_DATA';
  END IF;
END $$;

ALTER TABLE experience_observation
  ADD COLUMN scope text NOT NULL CHECK (
    scope IN ('goal_episode', 'planning_interaction', 'cross_episode_batch')
  ),
  ADD COLUMN source_episode_ids jsonb NOT NULL CHECK (
    jsonb_typeof(source_episode_ids) = 'array'
    AND jsonb_array_length(source_episode_ids) BETWEEN 1 AND 8
  ),
  ADD COLUMN observation_hash text NOT NULL UNIQUE CHECK (
    observation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN model_invocation_refs jsonb NOT NULL CHECK (
    jsonb_typeof(model_invocation_refs) = 'array'
  ),
  ADD CONSTRAINT experience_observation_primary_model_fk
    FOREIGN KEY (model_invocation_id) REFERENCES model_invocation(invocation_id);

CREATE INDEX experience_observation_created_idx
  ON experience_observation(created_at DESC, observation_id);
CREATE INDEX experience_observation_sources_idx
  ON experience_observation USING gin(source_episode_ids);

ALTER TABLE experience_observation_fact
  ADD CONSTRAINT experience_observation_fact_sources_nonempty CHECK (
    jsonb_array_length(source_ref_ids) >= 1
  );

ALTER TABLE experience_extraction
  ADD COLUMN model_invocation_id text REFERENCES model_invocation(invocation_id),
  ADD COLUMN source_episode_ids jsonb NOT NULL CHECK (
    jsonb_typeof(source_episode_ids) = 'array'
    AND jsonb_array_length(source_episode_ids) BETWEEN 1 AND 8
  ),
  ADD COLUMN model_tier text NOT NULL CHECK (model_tier IN ('fast', 'reasoning')),
  ADD COLUMN input_bytes integer NOT NULL CHECK (input_bytes BETWEEN 0 AND 524288),
  ADD COLUMN output_bytes integer NOT NULL CHECK (output_bytes BETWEEN 0 AND 262144),
  ADD CONSTRAINT experience_extraction_kind_check CHECK (extractor_kind IN (
    'goal_pattern', 'task_type_signal', 'decomposition', 'dependency', 'criterion',
    'evidence', 'artifact', 'capability', 'failure', 'recovery', 'no_progress',
    'human_correction'
  )),
  ADD CONSTRAINT experience_extraction_result_check CHECK (
    jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 262144
  ),
  ADD CONSTRAINT experience_extraction_error_check CHECK (
    (status = 'failed' AND error_code IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL)
  );

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation'
));

INSERT INTO schema_migration(version) VALUES ('0116_v123_experience_observation');

COMMIT;
