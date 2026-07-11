BEGIN;
DROP TABLE IF EXISTS workflow_plan_attempt;
DROP TABLE IF EXISTS workflow_plan;
DELETE FROM schema_migration WHERE version='0016_workflow_planning';
COMMIT;
