BEGIN;
ALTER TABLE workflow_control DROP COLUMN IF EXISTS task_id;
ALTER TABLE agent_task DROP COLUMN IF EXISTS capability_gap_json;
DELETE FROM schema_migration WHERE version='0030_task_capability_gap';
COMMIT;
