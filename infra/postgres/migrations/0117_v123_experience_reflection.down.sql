BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_reflection)
     OR EXISTS (SELECT 1 FROM knowledge_delta_record)
     OR EXISTS (SELECT 1 FROM knowledge_candidate_lineage) THEN
    RAISE EXCEPTION 'ROLLBACK_0117_REFUSED_REFLECTION_OR_LINEAGE_DATA_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM stage_model_route WHERE stage = 'experience_reflection') THEN
    RAISE EXCEPTION 'ROLLBACK_0117_REQUIRES_NO_EXPERIENCE_REFLECTION_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation'
));

DROP INDEX IF EXISTS knowledge_candidate_identity_idx;
DROP TABLE IF EXISTS knowledge_candidate_lineage;
DROP INDEX IF EXISTS knowledge_delta_fingerprint_idx;
DROP INDEX IF EXISTS knowledge_delta_reflection_idx;
DROP TABLE IF EXISTS knowledge_delta_record;

DROP INDEX IF EXISTS experience_reflection_observations_idx;
DROP INDEX IF EXISTS experience_reflection_created_idx;
ALTER TABLE experience_reflection
  DROP CONSTRAINT IF EXISTS experience_reflection_delta_array_check,
  DROP CONSTRAINT IF EXISTS experience_reflection_primary_model_fk,
  DROP COLUMN IF EXISTS model_invocation_refs,
  DROP COLUMN IF EXISTS reflection_hash,
  DROP COLUMN IF EXISTS impacts,
  DROP COLUMN IF EXISTS group_key,
  DROP COLUMN IF EXISTS observation_ids;

DELETE FROM schema_migration WHERE version = '0117_v123_experience_reflection';

COMMIT;
