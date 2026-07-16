BEGIN;

DROP TABLE IF EXISTS remote_task_protocol_attempt;
DROP TABLE IF EXISTS remote_task_control_event;
DROP TABLE IF EXISTS remote_task_observation;
DROP TABLE IF EXISTS remote_task_binding;
DELETE FROM schema_migration WHERE version='0100_remote_mcp_task_tracking';

COMMIT;
