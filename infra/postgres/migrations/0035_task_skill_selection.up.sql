BEGIN;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS skill_selection_id text;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_skill_selection_fk;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_skill_selection_fk
  FOREIGN KEY(skill_selection_id) REFERENCES skill_selection_record(selection_id);
INSERT INTO schema_migration(version) VALUES('0035_task_skill_selection')
ON CONFLICT(version) DO NOTHING;
COMMIT;
