BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM generic_task_understanding) THEN
    RAISE EXCEPTION 'MIGRATION_0111_ROLLBACK_REQUIRES_NO_TASK_UNDERSTANDING';
  END IF;
  IF EXISTS (SELECT 1 FROM stage_model_route WHERE stage = 'task_understanding') THEN
    RAISE EXCEPTION 'MIGRATION_0111_ROLLBACK_REQUIRES_NO_TASK_UNDERSTANDING_ROUTE';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing'
));

ALTER TABLE generic_task_understanding_dimension
  DROP CONSTRAINT generic_task_understanding_dimension_kind_check;
ALTER TABLE generic_task_understanding_dimension
  ADD CONSTRAINT generic_task_understanding_dimension_kind_check CHECK (kind IN (
    'target', 'scope', 'time_range', 'criteria', 'artifact', 'evidence',
    'side_effect_authorization'
  ));

ALTER TABLE generic_task_understanding DROP COLUMN model_invocation_id;

DELETE FROM schema_migration WHERE version = '0111_v123_task_understanding';

COMMIT;
