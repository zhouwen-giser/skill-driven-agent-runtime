-- Binding revisions are immutable semantic contracts. Governance and health are projections.
CREATE TABLE sdar_control.mcp_provider_binding_state (
  binding_id text PRIMARY KEY,
  binding_revision bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','imported','active','suspended','removed')),
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (binding_id, binding_revision)
    REFERENCES sdar_control.mcp_provider_binding(binding_id, revision) ON DELETE RESTRICT
);

INSERT INTO sdar_control.mcp_provider_binding_state(binding_id,binding_revision,status,updated_at)
SELECT DISTINCT ON (binding_id) binding_id,revision,
       CASE WHEN status='degraded' THEN 'active' ELSE status END,created_at
  FROM sdar_control.mcp_provider_binding
 ORDER BY binding_id,revision DESC;

-- A monotonic tie-breaker preserves the latest observation when a clock has coarse resolution.
ALTER TABLE sdar_control.mcp_provider_catalog_observation
  ADD COLUMN observation_sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX mcp_provider_catalog_observation_latest_revision_idx
  ON sdar_control.mcp_provider_catalog_observation(
    binding_id,binding_revision,observed_at DESC,observation_sequence DESC
  );

CREATE VIEW sdar_control.mcp_provider_binding_projection AS
SELECT binding.binding_id,binding.revision,binding.local_server_id,binding.origin_type,
       binding.smpp_source_id,binding.external_provider_id,binding.external_server_id,
       binding.registry_revision,binding.registry_checksum,binding.catalog_revision,
       binding.catalog_checksum,binding.endpoint_ref,binding.credential_ref,
       COALESCE(state.status,binding.status) AS status,
       COALESCE(observation.availability_status,binding.availability_status) AS availability_status,
       COALESCE(observation.availability_valid_until,binding.availability_valid_until)
         AS availability_valid_until,
       COALESCE(observation.observed_at,binding.catalog_observed_at) AS catalog_observed_at,
       binding.operation_count,binding.created_at
  FROM sdar_control.mcp_provider_binding binding
  LEFT JOIN sdar_control.mcp_provider_binding_state state
    ON state.binding_id=binding.binding_id AND state.binding_revision=binding.revision
  LEFT JOIN LATERAL (
    SELECT availability_status,availability_valid_until,observed_at
      FROM sdar_control.mcp_provider_catalog_observation
     WHERE binding_id=binding.binding_id AND binding_revision=binding.revision
     ORDER BY observed_at DESC,observation_sequence DESC
     LIMIT 1
  ) observation ON true;
