BEGIN;
DROP INDEX IF EXISTS evolution_experience_instance_idx;
DROP INDEX IF EXISTS model_invocation_task_model_idx;
ALTER TABLE model_invocation DROP COLUMN IF EXISTS task_id;
DELETE FROM schema_migration WHERE version='0049_evaluation_analytics';
COMMIT;
