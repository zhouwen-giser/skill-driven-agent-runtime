DROP TRIGGER IF EXISTS smpp_registry_sync_attempt_immutable ON sdar_control.smpp_registry_sync_attempt;
DROP TRIGGER IF EXISTS smpp_provider_candidate_immutable ON sdar_control.smpp_provider_candidate;
DROP TRIGGER IF EXISTS smpp_registry_snapshot_immutable ON sdar_control.smpp_registry_snapshot;
DROP TRIGGER IF EXISTS smpp_registry_source_definition_immutable ON sdar_control.smpp_registry_source;
DROP FUNCTION IF EXISTS sdar_control.protect_smpp_source_definition();
DROP TABLE IF EXISTS sdar_control.smpp_registry_sync_attempt;
DROP TABLE IF EXISTS sdar_control.smpp_provider_candidate;
DROP TABLE IF EXISTS sdar_control.smpp_registry_snapshot;
DROP TABLE IF EXISTS sdar_control.smpp_registry_source;
