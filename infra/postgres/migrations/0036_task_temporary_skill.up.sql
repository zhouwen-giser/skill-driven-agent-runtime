BEGIN;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS temporary_skill_id text;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_temporary_skill_fk;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_temporary_skill_fk
  FOREIGN KEY(temporary_skill_id) REFERENCES temporary_skill(temporary_skill_id);
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_skill_binding_check;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_skill_binding_check CHECK(
  NOT (selected_skill_id IS NOT NULL AND temporary_skill_id IS NOT NULL)
);
INSERT INTO schema_migration(version) VALUES('0036_task_temporary_skill')
ON CONFLICT(version) DO NOTHING;
COMMIT;
