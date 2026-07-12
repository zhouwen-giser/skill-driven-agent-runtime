BEGIN;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS selected_skill_id text;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS selected_skill_version integer;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_selected_skill_check;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_selected_skill_check CHECK(
  (selected_skill_id IS NULL AND selected_skill_version IS NULL) OR
  (selected_skill_id IS NOT NULL AND selected_skill_version > 0)
);
INSERT INTO schema_migration(version) VALUES('0033_task_selected_skill')
ON CONFLICT(version) DO NOTHING;
COMMIT;
