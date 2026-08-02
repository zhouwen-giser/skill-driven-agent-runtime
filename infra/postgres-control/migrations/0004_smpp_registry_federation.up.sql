CREATE TABLE sdar_control.smpp_registry_source (
  smpp_source_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  name text,
  registry_endpoint text NOT NULL,
  credential_ref text NOT NULL CHECK (credential_ref ~ '^secret://'),
  tenant_id text,
  project_id text,
  environment text NOT NULL,
  sync_mode text NOT NULL CHECK (sync_mode IN ('manual','poll','watch')),
  snapshot_ttl_seconds integer NOT NULL CHECK (snapshot_ttl_seconds > 0),
  lkg_policy text NOT NULL CHECK (lkg_policy IN ('allow_unexpired','deny_when_unavailable')),
  status text NOT NULL CHECK (status IN ('draft','active','suspended','retired')),
  active_snapshot_revision bigint CHECK (active_snapshot_revision IS NULL OR active_snapshot_revision > 0),
  active_snapshot_checksum char(64) CHECK (active_snapshot_checksum IS NULL OR active_snapshot_checksum ~ '^[a-f0-9]{64}$'),
  active_snapshot_etag text,
  last_sync_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (smpp_source_id, revision),
  CHECK (
    (active_snapshot_revision IS NULL AND active_snapshot_checksum IS NULL AND active_snapshot_etag IS NULL)
    OR
    (active_snapshot_revision IS NOT NULL AND active_snapshot_checksum IS NOT NULL AND active_snapshot_etag IS NOT NULL)
  )
);

CREATE INDEX smpp_registry_source_latest_idx
  ON sdar_control.smpp_registry_source(smpp_source_id, revision DESC);

CREATE UNIQUE INDEX smpp_registry_source_one_active_idx
  ON sdar_control.smpp_registry_source(smpp_source_id)
  WHERE status = 'active';

CREATE TABLE sdar_control.smpp_registry_snapshot (
  smpp_source_id text NOT NULL,
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  etag text NOT NULL,
  generated_at timestamptz NOT NULL,
  external_expires_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  provider_count integer NOT NULL CHECK (provider_count >= 0),
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (smpp_source_id, snapshot_revision),
  UNIQUE (smpp_source_id, checksum),
  CHECK (external_expires_at > generated_at),
  CHECK (valid_until <= external_expires_at)
);

CREATE TABLE sdar_control.smpp_provider_candidate (
  smpp_source_id text NOT NULL,
  snapshot_revision bigint NOT NULL,
  external_provider_id text NOT NULL,
  external_server_id text NOT NULL,
  composite_identity text NOT NULL,
  server_endpoint text NOT NULL,
  display_name text,
  catalog_revision text,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  PRIMARY KEY (smpp_source_id, snapshot_revision, external_provider_id, external_server_id),
  UNIQUE (smpp_source_id, snapshot_revision, composite_identity),
  FOREIGN KEY (smpp_source_id, snapshot_revision)
    REFERENCES sdar_control.smpp_registry_snapshot(smpp_source_id, snapshot_revision)
);

CREATE INDEX smpp_provider_candidate_identity_idx
  ON sdar_control.smpp_provider_candidate(composite_identity, snapshot_revision DESC);

CREATE TABLE sdar_control.smpp_registry_sync_attempt (
  attempt_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES sdar_control.management_operation(operation_id),
  smpp_source_id text NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  outcome text NOT NULL CHECK (outcome IN ('applied','not_modified','failed')),
  observed_snapshot_revision bigint,
  observed_checksum char(64) CHECK (observed_checksum IS NULL OR observed_checksum ~ '^[a-f0-9]{64}$'),
  observed_etag text,
  error_code text,
  occurred_at timestamptz NOT NULL,
  CHECK ((outcome = 'failed' AND error_code IS NOT NULL) OR (outcome <> 'failed' AND error_code IS NULL))
);

CREATE INDEX smpp_registry_sync_attempt_source_idx
  ON sdar_control.smpp_registry_sync_attempt(smpp_source_id, occurred_at DESC);

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

CREATE TRIGGER smpp_registry_source_definition_immutable
BEFORE UPDATE ON sdar_control.smpp_registry_source
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_smpp_source_definition();

CREATE TRIGGER smpp_registry_snapshot_immutable
BEFORE UPDATE OR DELETE ON sdar_control.smpp_registry_snapshot
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE TRIGGER smpp_provider_candidate_immutable
BEFORE UPDATE OR DELETE ON sdar_control.smpp_provider_candidate
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE TRIGGER smpp_registry_sync_attempt_immutable
BEFORE UPDATE OR DELETE ON sdar_control.smpp_registry_sync_attempt
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();
