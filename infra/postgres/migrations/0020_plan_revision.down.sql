BEGIN;
ALTER TABLE agent_task DROP COLUMN IF EXISTS plan_id;
ALTER TABLE workflow_plan
  DROP CONSTRAINT IF EXISTS workflow_plan_revision_kind_check,
  DROP COLUMN IF EXISTS revision_kind,
  DROP COLUMN IF EXISTS source_plan_id;
ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_confirmation_status_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_confirmation_status_check CHECK(
  confirmation_status IN ('awaiting_confirmation','confirmed','failed')
);
DELETE FROM schema_migration WHERE version='0020_plan_revision';
COMMIT;
