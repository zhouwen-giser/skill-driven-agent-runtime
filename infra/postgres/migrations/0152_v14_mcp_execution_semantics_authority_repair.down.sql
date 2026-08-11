BEGIN;

ALTER TABLE mcp_tool
  DROP CONSTRAINT mcp_tool_execution_semantics_authority_check;

-- The provenance backfill is intentionally retained. Clearing it would
-- recreate an execution-semantics state that the domain correctly rejects.
DELETE FROM schema_migration
WHERE version = '0152_v14_mcp_execution_semantics_authority_repair';

COMMIT;
