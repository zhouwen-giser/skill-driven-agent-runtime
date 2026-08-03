BEGIN;

DROP TRIGGER IF EXISTS cognitive_node_event_assign_sequence ON cognitive_runtime_outbox;
DROP FUNCTION IF EXISTS sdar_assign_node_event_outbox_sequence();
DELETE FROM cognitive_runtime_outbox WHERE event_type='node.task.capability_bound';
UPDATE cognitive_runtime_outbox
   SET outbox_sequence=NULL
 WHERE event_type='node.capability.readiness_changed';
DELETE FROM schema_migration WHERE version='0143_v14_node_event_projection';

COMMIT;
