BEGIN;

ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_goal_contract_identity_check;
ALTER TABLE skill_replacement_plan DROP COLUMN IF EXISTS goal_contract_json;
ALTER TABLE skill_selection_record DROP COLUMN IF EXISTS goal_contract_json;
ALTER TABLE workflow_plan_attempt DROP COLUMN IF EXISTS goal_contract_json;
ALTER TABLE workflow_plan DROP COLUMN IF EXISTS goal_contract_json;
DELETE FROM schema_migration WHERE version='0061_goal_execution_contract';

COMMIT;
