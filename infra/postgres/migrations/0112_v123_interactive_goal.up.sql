BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM interactive_goal_session)
     OR EXISTS (SELECT 1 FROM interactive_goal_turn)
     OR EXISTS (SELECT 1 FROM goal_contract_candidate) THEN
    RAISE EXCEPTION 'MIGRATION_0112_REQUIRES_EMPTY_UNRELEASED_INTERACTIVE_GOAL_DATA';
  END IF;
END $$;

ALTER TABLE interactive_goal_session
  ADD COLUMN max_elapsed_ms integer NOT NULL CHECK (max_elapsed_ms > 0);

ALTER TABLE interactive_goal_turn
  ADD COLUMN binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object');

ALTER TABLE goal_contract_candidate
  ADD COLUMN diff jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
  ADD COLUMN model_invocation_id text NOT NULL REFERENCES model_invocation(invocation_id);

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation'
));

INSERT INTO schema_migration(version) VALUES ('0112_v123_interactive_goal');

COMMIT;
