ALTER TABLE sdar_control.smpp_registry_source
  ADD COLUMN active_snapshot_valid_until timestamptz;

CREATE OR REPLACE FUNCTION sdar_control.protect_smpp_source_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND
     (to_jsonb(NEW) - 'status' - 'active_snapshot_revision' - 'active_snapshot_checksum'
       - 'active_snapshot_etag' - 'active_snapshot_valid_until' - 'last_sync_at'
       - 'last_error_code' - 'updated_at')
       IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'active_snapshot_revision' - 'active_snapshot_checksum'
       - 'active_snapshot_etag' - 'active_snapshot_valid_until' - 'last_sync_at'
       - 'last_error_code' - 'updated_at') THEN
    RAISE EXCEPTION 'CONTROL_SMPP_SOURCE_DEFINITION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE sdar_control.smpp_registry_source source
   SET active_snapshot_valid_until = snapshot.valid_until
  FROM sdar_control.smpp_registry_snapshot snapshot
 WHERE source.active_snapshot_revision IS NOT NULL
   AND source.smpp_source_id = snapshot.smpp_source_id
   AND source.active_snapshot_revision = snapshot.snapshot_revision;

ALTER TABLE sdar_control.smpp_registry_source
  ADD CONSTRAINT smpp_registry_source_active_validity_consistent CHECK (
    (active_snapshot_revision IS NULL AND active_snapshot_valid_until IS NULL)
    OR
    (active_snapshot_revision IS NOT NULL AND active_snapshot_valid_until IS NOT NULL)
  );

CREATE TABLE sdar_control.smpp_registry_snapshot_lineage (
  smpp_source_id text NOT NULL,
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  native_revision bigint NOT NULL CHECK (native_revision > 0),
  native_checksum char(64) NOT NULL CHECK (native_checksum ~ '^[a-f0-9]{64}$'),
  projection_contract text NOT NULL CHECK (projection_contract = 'sdar-registry-v1'),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (smpp_source_id, snapshot_revision),
  FOREIGN KEY (smpp_source_id, snapshot_revision)
    REFERENCES sdar_control.smpp_registry_snapshot(smpp_source_id, snapshot_revision)
);

CREATE TRIGGER smpp_registry_snapshot_lineage_immutable
BEFORE UPDATE OR DELETE ON sdar_control.smpp_registry_snapshot_lineage
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

ALTER TABLE sdar_control.smpp_registry_sync_attempt
  ADD COLUMN observed_native_revision bigint,
  ADD COLUMN observed_native_checksum char(64),
  ADD COLUMN observed_projection_contract text,
  ADD COLUMN observed_valid_until timestamptz,
  ADD CONSTRAINT smpp_registry_sync_attempt_native_lineage_consistent CHECK (
    (
      observed_native_revision IS NULL
      AND observed_native_checksum IS NULL
      AND observed_projection_contract IS NULL
    )
    OR
    (
      observed_native_revision IS NOT NULL
      AND observed_native_checksum IS NOT NULL
      AND observed_projection_contract IS NOT NULL
      AND observed_native_revision > 0
      AND observed_native_checksum ~ '^[a-f0-9]{64}$'
      AND observed_projection_contract = 'sdar-registry-v1'
    )
  );
