BEGIN;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS capability_gap_json jsonb;
ALTER TABLE workflow_control ADD COLUMN IF NOT EXISTS task_id text REFERENCES agent_task(task_id);
INSERT INTO schema_migration(version) VALUES('0030_task_capability_gap')
ON CONFLICT(version) DO NOTHING;
COMMIT;
