BEGIN;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_skill_binding_check;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_temporary_skill_fk;
ALTER TABLE agent_task DROP COLUMN IF EXISTS temporary_skill_id;
DELETE FROM schema_migration WHERE version='0036_task_temporary_skill';
COMMIT;
