BEGIN;

DROP TABLE IF EXISTS runtime_telemetry_export_outbox;
DROP TABLE IF EXISTS runtime_telemetry_export_state;
DROP TABLE IF EXISTS runtime_telemetry_export_configuration;
DELETE FROM schema_migration WHERE version='0142_v14_telemetry_export';

COMMIT;
