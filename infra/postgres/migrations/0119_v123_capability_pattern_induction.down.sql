BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM capability_pattern_definition
    WHERE definition_origin IN ('capability_pattern_induction', 'fixture')
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_0119_REFUSED_CAPABILITY_PATTERN_DATA_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM capability_gap_candidate) THEN
    RAISE EXCEPTION 'ROLLBACK_0119_REFUSED_CAPABILITY_GAP_DATA_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage_model_route WHERE stage = 'capability_pattern_induction'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_0119_REQUIRES_NO_CAPABILITY_PATTERN_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection', 'task_type_induction'
));

DROP TABLE capability_gap_candidate;
DROP INDEX IF EXISTS capability_pattern_definition_active_catalog_idx;
DROP INDEX IF EXISTS capability_pattern_definition_identity_idx;

ALTER TABLE capability_pattern_definition
  DROP COLUMN IF EXISTS model_invocation_id,
  DROP COLUMN IF EXISTS definition_origin,
  DROP COLUMN IF EXISTS fingerprint,
  DROP COLUMN IF EXISTS capability_id;

DELETE FROM schema_migration
WHERE version = '0119_v123_capability_pattern_induction';

COMMIT;
