BEGIN;
DROP TABLE IF EXISTS skill_call_workflow;
DELETE FROM schema_migration WHERE version='0034_skill_call_workflow';
COMMIT;
