BEGIN;
ALTER TABLE workflow_instance
  DROP CONSTRAINT IF EXISTS workflow_instance_termination_reason_check,
  DROP COLUMN IF EXISTS termination_reason,
  DROP COLUMN IF EXISTS budget_usage_json,
  DROP COLUMN IF EXISTS budget_limits_json,
  DROP COLUMN IF EXISTS skill_versions_json;
DELETE FROM schema_migration WHERE version='0018_workflow_budget';
COMMIT;
