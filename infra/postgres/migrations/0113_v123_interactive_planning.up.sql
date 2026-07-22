BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM interactive_planning_session)
     OR EXISTS (SELECT 1 FROM interactive_planning_turn)
     OR EXISTS (SELECT 1 FROM user_goal_plan_candidate) THEN
    RAISE EXCEPTION 'MIGRATION_0113_REQUIRES_EMPTY_UNRELEASED_INTERACTIVE_PLANNING_DATA';
  END IF;
END $$;

ALTER TABLE interactive_planning_session
  ADD COLUMN goal_id text NOT NULL,
  ADD COLUMN goal_version integer NOT NULL CHECK (goal_version >= 1),
  ADD COLUMN max_elapsed_ms integer NOT NULL CHECK (max_elapsed_ms > 0);

ALTER TABLE interactive_planning_turn
  ADD COLUMN compiled_patch jsonb;

ALTER TABLE user_goal_plan_candidate
  ADD COLUMN diff jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
  ADD COLUMN experience_hints jsonb NOT NULL CHECK (jsonb_typeof(experience_hints) = 'array'),
  ADD COLUMN confirmation_policy text NOT NULL CHECK (
    confirmation_policy IN ('manual_all', 'manual_risky', 'auto_validated', 'never_auto')
  ),
  ADD COLUMN risk_level text NOT NULL CHECK (risk_level IN ('low', 'high')),
  ADD COLUMN planning_metadata jsonb NOT NULL CHECK (jsonb_typeof(planning_metadata) = 'object'),
  ADD COLUMN patch_model_invocation_id text REFERENCES model_invocation(invocation_id);

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch'
));

INSERT INTO schema_migration(version) VALUES ('0113_v123_interactive_planning');

COMMIT;
