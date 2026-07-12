BEGIN;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_selected_skill_check;
ALTER TABLE agent_task DROP COLUMN IF EXISTS selected_skill_version;
ALTER TABLE agent_task DROP COLUMN IF EXISTS selected_skill_id;
DELETE FROM schema_migration WHERE version='0033_task_selected_skill';
COMMIT;
