BEGIN;
ALTER TABLE goal_patch
  ADD COLUMN IF NOT EXISTS triggering_task_id text REFERENCES agent_task(task_id);
CREATE INDEX IF NOT EXISTS idx_goal_patch_triggering_task
  ON goal_patch(triggering_task_id)
  WHERE triggering_task_id IS NOT NULL;
ALTER TABLE workflow_plan
  ADD COLUMN IF NOT EXISTS confirmation_task_id text REFERENCES agent_task(task_id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_workflow_plan_confirmation_task
  ON workflow_plan(confirmation_task_id)
  WHERE confirmation_task_id IS NOT NULL;
INSERT INTO schema_migration(version)
VALUES('0052_observability_correlation')
ON CONFLICT(version) DO NOTHING;
COMMIT;
