BEGIN;

-- Governed confirmations are immutable audit records. Their frozen server/tool
-- identity must outlive the mutable Runtime Catalog entry they authorized.
ALTER TABLE governed_control_confirmation
  DROP CONSTRAINT governed_control_confirmation_tool_fk;

INSERT INTO schema_migration(version)
VALUES ('0164_v14_governed_control_catalog_lineage');

COMMIT;
