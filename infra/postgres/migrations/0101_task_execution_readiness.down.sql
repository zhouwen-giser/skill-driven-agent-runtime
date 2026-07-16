BEGIN;

DROP TABLE IF EXISTS task_availability_snapshot;
DROP TABLE IF EXISTS task_execution_readiness;
ALTER TABLE mcp_tool DROP COLUMN IF EXISTS task_execution_json;
DELETE FROM schema_migration WHERE version='0101_task_execution_readiness';

COMMIT;
