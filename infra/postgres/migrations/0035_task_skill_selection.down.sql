BEGIN;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_skill_selection_fk;
ALTER TABLE agent_task DROP COLUMN IF EXISTS skill_selection_id;
DELETE FROM schema_migration WHERE version='0035_task_skill_selection';
COMMIT;
