BEGIN;
UPDATE workflow_instance
SET status='failed', pending_confirmation_json=NULL, completed_at=COALESCE(completed_at, now())
WHERE status='paused';
ALTER TABLE workflow_instance DROP COLUMN IF EXISTS pending_confirmation_json;
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','succeeded','failed')
);
DELETE FROM schema_migration WHERE version='0021_workflow_interrupt';
COMMIT;
