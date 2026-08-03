BEGIN;

CREATE OR REPLACE FUNCTION sdar_assign_node_event_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN (
    'node.capability.readiness_changed',
    'node.task.capability_bound'
  ) AND NEW.outbox_sequence IS NULL THEN
    PERFORM pg_advisory_xact_lock(53444152,125);
    SELECT COALESCE(MAX(event.outbox_sequence),0)+1
      INTO NEW.outbox_sequence
      FROM cognitive_runtime_outbox event;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cognitive_node_event_assign_sequence
BEFORE INSERT ON cognitive_runtime_outbox
FOR EACH ROW EXECUTE FUNCTION sdar_assign_node_event_outbox_sequence();

WITH sequenced AS (
  SELECT event_id,
         COALESCE((SELECT MAX(outbox_sequence) FROM cognitive_runtime_outbox),0)
           + row_number() OVER (ORDER BY occurred_at,event_id) AS next_sequence
    FROM cognitive_runtime_outbox
   WHERE outbox_sequence IS NULL
     AND event_type='node.capability.readiness_changed'
)
UPDATE cognitive_runtime_outbox event
   SET outbox_sequence=sequenced.next_sequence
  FROM sequenced
 WHERE event.event_id=sequenced.event_id;

INSERT INTO schema_migration(version) VALUES ('0143_v14_node_event_projection');

COMMIT;
