BEGIN;
ALTER TABLE workflow_node_event DROP COLUMN IF EXISTS duration_ms;
DELETE FROM schema_migration WHERE version='0051_workflow_node_duration';
COMMIT;
