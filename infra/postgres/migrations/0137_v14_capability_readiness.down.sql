BEGIN;
DELETE FROM cognitive_runtime_outbox WHERE event_type='node.capability.readiness_changed';
DROP TRIGGER capability_readiness_immutable ON capability_readiness_snapshot;
DROP FUNCTION prevent_capability_readiness_mutation();
DROP TABLE capability_readiness_command_receipt;
DROP TABLE capability_readiness_snapshot;
DELETE FROM schema_migration WHERE version='0137_v14_capability_readiness';
COMMIT;
