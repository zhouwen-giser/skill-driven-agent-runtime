BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM interactive_goal_session)
     OR EXISTS (SELECT 1 FROM interactive_goal_turn)
     OR EXISTS (SELECT 1 FROM goal_contract_candidate) THEN
    RAISE EXCEPTION 'MIGRATION_0112_ROLLBACK_REQUIRES_NO_INTERACTIVE_GOAL_DATA';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage_model_route
    WHERE stage IN ('task_clarification', 'goal_contract_generation')
  ) THEN
    RAISE EXCEPTION 'MIGRATION_0112_ROLLBACK_REQUIRES_NO_INTERACTIVE_GOAL_MODEL_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding'
));

ALTER TABLE goal_contract_candidate
  DROP COLUMN model_invocation_id,
  DROP COLUMN diff;
ALTER TABLE interactive_goal_turn DROP COLUMN binding;
ALTER TABLE interactive_goal_session DROP COLUMN max_elapsed_ms;

DELETE FROM schema_migration WHERE version = '0112_v123_interactive_goal';

COMMIT;
