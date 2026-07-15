BEGIN;

DROP INDEX IF EXISTS mcp_invocation_execution_mode_idx;
ALTER TABLE mcp_invocation DROP CONSTRAINT IF EXISTS mcp_invocation_execution_context_check;
ALTER TABLE mcp_invocation DROP COLUMN IF EXISTS simulation_id;
ALTER TABLE mcp_invocation DROP COLUMN IF EXISTS execution_mode;
DELETE FROM schema_migration WHERE version='0056_mcp_execution_mode';

COMMIT;
