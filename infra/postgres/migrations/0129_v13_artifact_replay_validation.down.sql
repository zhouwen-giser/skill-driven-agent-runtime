-- 0129_v13_artifact_replay_validation.down.sql
-- Rollback removes only P05 replay-validation structures.

BEGIN;

DROP TRIGGER IF EXISTS artifact_replay_case_delete_propagation ON artifact_replay_case;
DROP FUNCTION IF EXISTS sdar_delete_replay_datasets_for_case();
DROP TRIGGER IF EXISTS artifact_counterexample_immutability ON artifact_counterexample;
DROP TRIGGER IF EXISTS artifact_validation_failure_immutability ON artifact_validation_failure;
DROP TRIGGER IF EXISTS artifact_replay_case_result_immutability ON artifact_replay_case_result;
DROP TRIGGER IF EXISTS replay_dataset_manifest_immutability ON replay_dataset_manifest;
DROP TRIGGER IF EXISTS artifact_replay_case_immutability ON artifact_replay_case;
DROP FUNCTION IF EXISTS sdar_reject_artifact_replay_content_mutation();

DROP TABLE IF EXISTS artifact_counterexample;
DROP TABLE IF EXISTS artifact_validation_failure;
DROP TABLE IF EXISTS artifact_replay_case_result;

DROP INDEX IF EXISTS artifact_validation_run_expired_lease_idx;
DROP INDEX IF EXISTS artifact_validation_run_work_idx;
DROP INDEX IF EXISTS artifact_validation_run_source_event_idx;
DROP INDEX IF EXISTS artifact_validation_run_idempotency_idx;

ALTER TABLE artifact_validation_run
  DROP CONSTRAINT IF EXISTS artifact_validation_run_replay_pin_check,
  DROP CONSTRAINT IF EXISTS artifact_validation_run_lease_check,
  DROP CONSTRAINT IF EXISTS artifact_validation_run_replay_dataset_fk,
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS dataset_version,
  DROP COLUMN IF EXISTS artifact_hash,
  DROP COLUMN IF EXISTS dataset_hash,
  DROP COLUMN IF EXISTS validator_version,
  DROP COLUMN IF EXISTS metric_catalog_version,
  DROP COLUMN IF EXISTS result_hash,
  DROP COLUMN IF EXISTS result_payload,
  DROP COLUMN IF EXISTS work_state,
  DROP COLUMN IF EXISTS attempt,
  DROP COLUMN IF EXISTS max_attempts,
  DROP COLUMN IF EXISTS available_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS cancel_requested_at,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS source_event_id,
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS last_error_summary,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

DROP TABLE IF EXISTS replay_dataset_case;
DROP TABLE IF EXISTS replay_dataset_manifest;
DROP TABLE IF EXISTS artifact_replay_case;
DROP TABLE IF EXISTS artifact_replay_tenant_deletion;

DELETE FROM schema_migration
WHERE version='0129_v13_artifact_replay_validation';

COMMIT;
