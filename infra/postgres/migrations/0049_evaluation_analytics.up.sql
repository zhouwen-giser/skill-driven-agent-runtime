BEGIN;
ALTER TABLE model_invocation ADD COLUMN IF NOT EXISTS task_id text REFERENCES agent_task(task_id);
CREATE INDEX IF NOT EXISTS model_invocation_task_model_idx
  ON model_invocation(task_id,provider_id,model,created_at);
CREATE INDEX IF NOT EXISTS evolution_experience_instance_idx
  ON evolution_experience(instance_id);
INSERT INTO schema_migration(version) VALUES('0049_evaluation_analytics')
  ON CONFLICT(version) DO NOTHING;
COMMIT;
