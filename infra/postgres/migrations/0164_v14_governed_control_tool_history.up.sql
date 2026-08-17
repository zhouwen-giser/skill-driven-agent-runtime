BEGIN;

-- A governed confirmation freezes the exact server/tool identity, arguments hash,
-- Provider Binding and immutable Capability attempt. It is historical evidence,
-- not a reference to the mutable current MCP catalog row. Keeping this FK made a
-- normal catalog refresh delete/reinsert fail after the first confirmation.
ALTER TABLE governed_control_confirmation
  DROP CONSTRAINT governed_control_confirmation_tool_fk;

INSERT INTO schema_migration(version)
VALUES ('0164_v14_governed_control_tool_history');

COMMIT;
