BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_observation)
     OR EXISTS (SELECT 1 FROM experience_observation_fact)
     OR EXISTS (SELECT 1 FROM experience_extraction)
     OR EXISTS (SELECT 1 FROM experience_reflection) THEN
    RAISE EXCEPTION 'ROLLBACK_0116_REFUSED_OBSERVATION_DATA_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM stage_model_route WHERE stage = 'experience_observation') THEN
    RAISE EXCEPTION 'ROLLBACK_0116_REQUIRES_NO_EXPERIENCE_OBSERVATION_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch'
));

ALTER TABLE experience_extraction
  DROP CONSTRAINT IF EXISTS experience_extraction_error_check,
  DROP CONSTRAINT IF EXISTS experience_extraction_result_check,
  DROP CONSTRAINT IF EXISTS experience_extraction_kind_check,
  DROP COLUMN IF EXISTS output_bytes,
  DROP COLUMN IF EXISTS input_bytes,
  DROP COLUMN IF EXISTS model_tier,
  DROP COLUMN IF EXISTS source_episode_ids,
  DROP COLUMN IF EXISTS model_invocation_id;

ALTER TABLE experience_observation_fact
  DROP CONSTRAINT IF EXISTS experience_observation_fact_sources_nonempty;

DROP INDEX IF EXISTS experience_observation_sources_idx;
DROP INDEX IF EXISTS experience_observation_created_idx;
ALTER TABLE experience_observation
  DROP CONSTRAINT IF EXISTS experience_observation_primary_model_fk,
  DROP COLUMN IF EXISTS model_invocation_refs,
  DROP COLUMN IF EXISTS observation_hash,
  DROP COLUMN IF EXISTS source_episode_ids,
  DROP COLUMN IF EXISTS scope;

DELETE FROM schema_migration WHERE version = '0116_v123_experience_observation';

COMMIT;
