BEGIN;
DROP TABLE IF EXISTS workflow_control_round;
DROP TABLE IF EXISTS workflow_control;
DELETE FROM schema_migration WHERE version='0019_workflow_control';
COMMIT;
