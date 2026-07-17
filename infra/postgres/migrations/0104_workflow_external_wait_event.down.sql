BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workflow_node_event WHERE event_type = 'node_waiting_external'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_0104_ROLLBACK_REQUIRES_NO_EXTERNAL_WAIT_EVENTS';
  END IF;
END
$$;

ALTER TABLE workflow_node_event
  DROP CONSTRAINT IF EXISTS workflow_node_event_event_type_check;

ALTER TABLE workflow_node_event
  ADD CONSTRAINT workflow_node_event_event_type_check CHECK (
    event_type IN ('node_started', 'node_succeeded', 'node_failed')
  );

DELETE FROM schema_migration WHERE version = '0104_workflow_external_wait_event';

COMMIT;
