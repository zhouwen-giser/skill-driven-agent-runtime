BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM skill_input_resolution) OR
     EXISTS (SELECT 1 FROM task_input_request WHERE source='skill_input_resolution') OR
     EXISTS (SELECT 1 FROM model_invocation WHERE stage='skill_input_resolution') OR
     EXISTS (SELECT 1 FROM stage_model_route WHERE stage='skill_input_resolution') OR
     EXISTS (SELECT 1 FROM prompt WHERE stage='skill_input_resolution') THEN
    RAISE EXCEPTION '0059 rollback requires exported and removed Skill input resolution evidence/configuration';
  END IF;
END $$;

DROP TABLE skill_input_resolution;

ALTER TABLE task_input_request DROP CONSTRAINT task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK(
  source IN ('goal_deliberation','goal_evaluation','workflow')
);

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK(
  stage IN ('intent','goal','tool_enhancement','skill_authoring','skill_selection','workflow_planning',
            'execution_decision','goal_evaluation','evaluation','result_processing')
);

DELETE FROM schema_migration WHERE version='0059_skill_input_resolution';

COMMIT;
