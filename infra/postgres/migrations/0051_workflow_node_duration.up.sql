BEGIN;
ALTER TABLE workflow_node_event
  ADD COLUMN IF NOT EXISTS duration_ms integer CHECK(duration_ms >= 0);
INSERT INTO schema_migration(version)
VALUES('0051_workflow_node_duration')
ON CONFLICT(version) DO NOTHING;
COMMIT;
