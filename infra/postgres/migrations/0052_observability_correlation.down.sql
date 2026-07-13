BEGIN;
DROP INDEX IF EXISTS idx_workflow_plan_confirmation_task;
ALTER TABLE workflow_plan
  DROP COLUMN IF EXISTS confirmation_task_id,
  DROP COLUMN IF EXISTS confirmed_at;
DROP INDEX IF EXISTS idx_goal_patch_triggering_task;
ALTER TABLE goal_patch DROP COLUMN IF EXISTS triggering_task_id;
DELETE FROM schema_migration WHERE version='0052_observability_correlation';
COMMIT;
