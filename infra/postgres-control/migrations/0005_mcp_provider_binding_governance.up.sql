CREATE TABLE sdar_control.mcp_provider_binding (
  binding_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  local_server_id text NOT NULL,
  origin_type text NOT NULL CHECK (origin_type IN ('direct','smpp_registry')),
  smpp_source_id text,
  external_provider_id text,
  external_server_id text,
  registry_revision bigint CHECK (registry_revision IS NULL OR registry_revision > 0),
  registry_checksum char(64) CHECK (registry_checksum IS NULL OR registry_checksum ~ '^[a-f0-9]{64}$'),
  catalog_revision text NOT NULL,
  catalog_checksum char(64) NOT NULL CHECK (catalog_checksum ~ '^[a-f0-9]{64}$'),
  endpoint_ref text NOT NULL,
  credential_ref text NOT NULL CHECK (credential_ref ~ '^secret://'),
  status text NOT NULL CHECK (status IN ('candidate','imported','active','degraded','suspended','removed')),
  availability_status text NOT NULL CHECK (availability_status IN ('unknown','available','degraded','unavailable')),
  availability_valid_until timestamptz NOT NULL,
  catalog_observed_at timestamptz NOT NULL,
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 0 AND 1024),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (binding_id, revision),
  CHECK (availability_valid_until > catalog_observed_at),
  CHECK (
    (origin_type='direct' AND smpp_source_id IS NULL AND external_provider_id IS NULL
      AND external_server_id IS NULL AND registry_revision IS NULL AND registry_checksum IS NULL)
    OR
    (origin_type='smpp_registry' AND smpp_source_id IS NOT NULL AND external_provider_id IS NOT NULL
      AND external_server_id IS NOT NULL AND registry_revision IS NOT NULL AND registry_checksum IS NOT NULL)
  )
);

CREATE INDEX mcp_provider_binding_latest_idx
  ON sdar_control.mcp_provider_binding(binding_id, revision DESC);
CREATE INDEX mcp_provider_binding_local_selection_idx
  ON sdar_control.mcp_provider_binding(local_server_id, revision DESC, availability_valid_until)
  WHERE status='active' AND availability_status='available';

CREATE TABLE sdar_control.mcp_provider_catalog_observation (
  observation_id text PRIMARY KEY,
  binding_id text NOT NULL,
  binding_revision bigint NOT NULL,
  catalog_revision text NOT NULL,
  catalog_checksum char(64) NOT NULL CHECK (catalog_checksum ~ '^[a-f0-9]{64}$'),
  availability_status text NOT NULL CHECK (availability_status IN ('unknown','available','degraded','unavailable')),
  availability_valid_until timestamptz NOT NULL,
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 0 AND 1024),
  result_code text NOT NULL,
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (binding_id, binding_revision)
    REFERENCES sdar_control.mcp_provider_binding(binding_id, revision) ON DELETE RESTRICT
);

CREATE INDEX mcp_provider_catalog_observation_binding_idx
  ON sdar_control.mcp_provider_catalog_observation(binding_id, observed_at DESC);

CREATE TRIGGER mcp_provider_binding_immutable
BEFORE UPDATE OR DELETE ON sdar_control.mcp_provider_binding
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE TRIGGER mcp_provider_catalog_observation_immutable
BEFORE UPDATE OR DELETE ON sdar_control.mcp_provider_catalog_observation
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();
