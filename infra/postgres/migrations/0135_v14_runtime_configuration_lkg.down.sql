BEGIN;

DROP TRIGGER IF EXISTS runtime_task_configuration_binding_immutable
  ON runtime_task_configuration_binding;
DROP FUNCTION IF EXISTS sdar_reject_runtime_configuration_binding_mutation();
DROP TABLE IF EXISTS runtime_task_configuration_binding;
DROP TABLE IF EXISTS runtime_configuration_ack_outbox;
DROP TABLE IF EXISTS runtime_configuration_snapshot;
DELETE FROM schema_migration WHERE version='0135_v14_runtime_configuration_lkg';

COMMIT;
