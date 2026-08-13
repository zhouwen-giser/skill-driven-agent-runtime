-- Rollback precondition: no historical Source or Binding row may retain the explicit sentinel.
-- A later SecretRef-backed revision is insufficient because CHECK constraints cover every retained
-- revision. Keep 0011 applied unless a separately reviewed export/removal/rebuild procedure has
-- eliminated every sentinel row. The guard below preserves all rows and leaves 0011 applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM sdar_control.smpp_registry_source
     WHERE credential_ref = 'unauthenticated://none'
  ) OR EXISTS (
    SELECT 1
      FROM sdar_control.mcp_provider_binding
     WHERE credential_ref = 'unauthenticated://none'
  ) THEN
    RAISE EXCEPTION 'CONTROL_UNAUTHENTICATED_CREDENTIAL_ROWS_REQUIRE_RECONFIGURATION'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE sdar_control.smpp_registry_source
  DROP CONSTRAINT smpp_registry_source_credential_ref_check,
  ADD CONSTRAINT smpp_registry_source_credential_ref_check CHECK (
    credential_ref ~ '^secret://'
  );

ALTER TABLE sdar_control.mcp_provider_binding
  DROP CONSTRAINT mcp_provider_binding_credential_ref_check,
  ADD CONSTRAINT mcp_provider_binding_credential_ref_check CHECK (
    credential_ref ~ '^secret://'
  );
