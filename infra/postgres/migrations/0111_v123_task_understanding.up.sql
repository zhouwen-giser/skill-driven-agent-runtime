BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM generic_task_understanding) THEN
    RAISE EXCEPTION 'MIGRATION_0111_REQUIRES_EMPTY_UNRELEASED_TASK_UNDERSTANDING';
  END IF;
END $$;

ALTER TABLE generic_task_understanding
  ADD COLUMN model_invocation_id text NOT NULL
    REFERENCES model_invocation(invocation_id);

ALTER TABLE generic_task_understanding_dimension
  DROP CONSTRAINT generic_task_understanding_dimension_kind_check;
ALTER TABLE generic_task_understanding_dimension
  ADD CONSTRAINT generic_task_understanding_dimension_kind_check CHECK (kind IN (
    'target', 'scope', 'time_range', 'priority', 'criteria', 'artifact', 'evidence',
    'side_effect_authorization', 'risk_tolerance', 'degradation_policy',
    'uncovered_case_policy', 'human_confirmation_policy'
  ));

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding'
));

INSERT INTO schema_migration(version) VALUES ('0111_v123_task_understanding');

COMMIT;
