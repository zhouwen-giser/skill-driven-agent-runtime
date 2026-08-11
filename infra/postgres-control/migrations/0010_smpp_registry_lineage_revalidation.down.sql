CREATE OR REPLACE FUNCTION sdar_control.protect_smpp_source_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND
     (to_jsonb(NEW) - 'status' - 'active_snapshot_revision' - 'active_snapshot_checksum'
       - 'active_snapshot_etag' - 'last_sync_at' - 'last_error_code' - 'updated_at')
       IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'active_snapshot_revision' - 'active_snapshot_checksum'
       - 'active_snapshot_etag' - 'last_sync_at' - 'last_error_code' - 'updated_at') THEN
    RAISE EXCEPTION 'CONTROL_SMPP_SOURCE_DEFINITION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE sdar_control.smpp_registry_sync_attempt
  DROP CONSTRAINT IF EXISTS smpp_registry_sync_attempt_native_lineage_consistent,
  DROP COLUMN IF EXISTS observed_valid_until,
  DROP COLUMN IF EXISTS observed_projection_contract,
  DROP COLUMN IF EXISTS observed_native_checksum,
  DROP COLUMN IF EXISTS observed_native_revision;

DROP TRIGGER IF EXISTS smpp_registry_snapshot_lineage_immutable
  ON sdar_control.smpp_registry_snapshot_lineage;
DROP TABLE IF EXISTS sdar_control.smpp_registry_snapshot_lineage;

ALTER TABLE sdar_control.smpp_registry_source
  DROP CONSTRAINT IF EXISTS smpp_registry_source_active_validity_consistent,
  DROP COLUMN IF EXISTS active_snapshot_valid_until;
