BEGIN;
ALTER TABLE agent_task DROP COLUMN IF EXISTS request_metadata;
ALTER TABLE agent_task DROP COLUMN IF EXISTS request_text;
DELETE FROM schema_migration WHERE version = '0004_task_request';
COMMIT;
