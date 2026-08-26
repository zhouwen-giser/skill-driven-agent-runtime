-- Old binaries ignore independent health/governance. Do not silently resurrect revoked authority
-- or discard renewals: export/reconcile those states before a separately reviewed rollback.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sdar_control.mcp_provider_binding_state state
      JOIN sdar_control.mcp_provider_binding binding
        ON binding.binding_id=state.binding_id AND binding.revision=state.binding_revision
     WHERE state.status<>binding.status
  ) OR EXISTS (
    SELECT 1 FROM sdar_control.mcp_provider_binding_projection projection
      JOIN sdar_control.mcp_provider_binding binding
        ON binding.binding_id=projection.binding_id AND binding.revision=projection.revision
     WHERE projection.availability_status<>binding.availability_status
        OR projection.availability_valid_until<>binding.availability_valid_until
        OR projection.catalog_observed_at<>binding.catalog_observed_at
  ) THEN
    RAISE EXCEPTION 'CONTROL_MCP_BINDING_HEALTH_STATE_REQUIRES_RECONCILIATION'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP VIEW sdar_control.mcp_provider_binding_projection;
DROP INDEX sdar_control.mcp_provider_catalog_observation_latest_revision_idx;
ALTER TABLE sdar_control.mcp_provider_catalog_observation DROP COLUMN observation_sequence;
DROP TABLE sdar_control.mcp_provider_binding_state;
