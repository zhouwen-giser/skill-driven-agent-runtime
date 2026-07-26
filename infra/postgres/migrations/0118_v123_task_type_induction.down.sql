BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM task_type_definition
    WHERE definition_origin IN ('task_type_induction', 'fixture')
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_0118_REFUSED_TASK_TYPE_INDUCTION_DATA_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM stage_model_route WHERE stage = 'task_type_induction') THEN
    RAISE EXCEPTION 'ROLLBACK_0118_REQUIRES_NO_TASK_TYPE_INDUCTION_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection'
));

DROP INDEX IF EXISTS task_type_definition_candidate_fingerprint_idx;
ALTER TABLE task_type_definition
  DROP COLUMN IF EXISTS model_invocation_id,
  DROP COLUMN IF EXISTS definition_origin;

DELETE FROM schema_migration WHERE version = '0118_v123_task_type_induction';

COMMIT;
