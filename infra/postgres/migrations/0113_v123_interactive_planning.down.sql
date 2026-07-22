BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM interactive_planning_session)
     OR EXISTS (SELECT 1 FROM interactive_planning_turn)
     OR EXISTS (SELECT 1 FROM user_goal_plan_candidate) THEN
    RAISE EXCEPTION 'MIGRATION_0113_ROLLBACK_REQUIRES_NO_INTERACTIVE_PLANNING_DATA';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage_model_route WHERE stage = 'interactive_plan_patch'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_0113_ROLLBACK_REQUIRES_NO_INTERACTIVE_PLAN_PATCH_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation'
));

ALTER TABLE user_goal_plan_candidate
  DROP COLUMN patch_model_invocation_id,
  DROP COLUMN planning_metadata,
  DROP COLUMN risk_level,
  DROP COLUMN confirmation_policy,
  DROP COLUMN experience_hints,
  DROP COLUMN diff;
ALTER TABLE interactive_planning_turn DROP COLUMN compiled_patch;
ALTER TABLE interactive_planning_session
  DROP COLUMN max_elapsed_ms,
  DROP COLUMN goal_version,
  DROP COLUMN goal_id;

DELETE FROM schema_migration WHERE version = '0113_v123_interactive_planning';

COMMIT;
