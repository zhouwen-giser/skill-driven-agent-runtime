BEGIN;

DROP TABLE IF EXISTS task_execution_attempt;
DROP TABLE IF EXISTS task_input_response;
DROP TABLE IF EXISTS task_input_request;
DELETE FROM schema_migration WHERE version='0055_task_input_continuation';

COMMIT;
