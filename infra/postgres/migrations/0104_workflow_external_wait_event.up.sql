BEGIN;

ALTER TABLE workflow_node_event
  DROP CONSTRAINT IF EXISTS workflow_node_event_event_type_check;

ALTER TABLE workflow_node_event
  ADD CONSTRAINT workflow_node_event_event_type_check CHECK (
    event_type IN ('node_started', 'node_succeeded', 'node_failed', 'node_waiting_external')
  );

INSERT INTO schema_migration(version)
VALUES ('0104_workflow_external_wait_event')
ON CONFLICT(version) DO NOTHING;

COMMIT;
