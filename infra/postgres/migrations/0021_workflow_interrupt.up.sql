BEGIN;
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed')
);
ALTER TABLE workflow_instance ADD COLUMN IF NOT EXISTS pending_confirmation_json jsonb;
INSERT INTO schema_migration(version) VALUES('0021_workflow_interrupt') ON CONFLICT(version) DO NOTHING;
COMMIT;
