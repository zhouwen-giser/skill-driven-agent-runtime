BEGIN;
-- Rollback is only for the disposable development database; no identity backfill is provided.
DROP TRIGGER runtime_provider_binding_immutable ON remote_task_binding;
DROP FUNCTION runtime_provider_binding_immutable();
DROP TRIGGER runtime_remote_admission_immutable ON remote_task_admission_intent;
DROP FUNCTION runtime_remote_admission_immutable();
ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT remote_task_receipt_dispatch_authority_check,
  DROP CONSTRAINT remote_task_dispatch_authority_check,
  DROP COLUMN accepted_binding_id,
  DROP COLUMN dispatch_authority_snapshot_json;
ALTER TABLE remote_task_binding
  DROP CONSTRAINT runtime_provider_binding_authority_check,
  DROP COLUMN binding_revision,
  DROP COLUMN registry_checksum,
  DROP COLUMN registry_revision,
  DROP COLUMN external_server_id,
  DROP COLUMN external_provider_instance_id,
  DROP COLUMN external_provider_id,
  DROP COLUMN provider_origin_source_id,
  DROP COLUMN provider_origin_type,
  DROP COLUMN a2a_task_id,
  DROP COLUMN sdar_invocation_id,
  DROP COLUMN sdar_task_id,
  DROP COLUMN episode_id,
  DROP COLUMN environment,
  DROP COLUMN project_id,
  DROP COLUMN tenant_id,
  DROP COLUMN last_task_projection,
  DROP COLUMN last_task_snapshot_json,
  DROP COLUMN provider_identity_json,
  DROP COLUMN binding_authority_json,
  ALTER COLUMN authority_snapshot_json DROP NOT NULL;
DROP FUNCTION runtime_provider_binding_authority_valid(jsonb);
-- Reset the disposable database before rollback if it contains new rejection dispositions.
ALTER TABLE remote_task_observation DROP CONSTRAINT remote_task_observation_rejection_reason_check;
ALTER TABLE remote_task_observation ADD CONSTRAINT remote_task_observation_rejection_reason_check
  CHECK (rejection_reason IS NULL OR rejection_reason IN ('stale_provider_revision','binding_closed'));
DROP INDEX remote_task_observation_provider_event_idx;
CREATE UNIQUE INDEX remote_task_observation_provider_event_idx
  ON remote_task_observation(binding_id,provider_event_id) WHERE provider_event_id IS NOT NULL;
DELETE FROM schema_migration WHERE version='0174_runtime_provider_binding_authority';
COMMIT;
