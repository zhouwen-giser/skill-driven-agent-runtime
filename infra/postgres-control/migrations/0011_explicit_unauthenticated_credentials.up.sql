ALTER TABLE sdar_control.smpp_registry_source
  DROP CONSTRAINT smpp_registry_source_credential_ref_check,
  ADD CONSTRAINT smpp_registry_source_credential_ref_check CHECK (
    credential_ref ~ '^secret://'
    OR credential_ref = 'unauthenticated://none'
  ) NOT VALID;

ALTER TABLE sdar_control.smpp_registry_source
  VALIDATE CONSTRAINT smpp_registry_source_credential_ref_check;

ALTER TABLE sdar_control.mcp_provider_binding
  DROP CONSTRAINT mcp_provider_binding_credential_ref_check,
  ADD CONSTRAINT mcp_provider_binding_credential_ref_check CHECK (
    credential_ref ~ '^secret://'
    OR credential_ref = 'unauthenticated://none'
  ) NOT VALID;

ALTER TABLE sdar_control.mcp_provider_binding
  VALIDATE CONSTRAINT mcp_provider_binding_credential_ref_check;
