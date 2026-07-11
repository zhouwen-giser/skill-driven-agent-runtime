BEGIN;
DROP TABLE IF EXISTS workflow_node_event;
DROP TABLE IF EXISTS workflow_instance;
DELETE FROM schema_migration WHERE version='0017_workflow_execution';
COMMIT;
