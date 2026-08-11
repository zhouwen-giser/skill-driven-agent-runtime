BEGIN;

-- Frozen refreshes before 0152 retained the effective admin or declared
-- semantics in memory but dropped their provenance columns while replacing
-- the Tool rows. Reconstruct only the authority explicitly named by the
-- persisted effective value; every other inconsistent shape remains a hard
-- migration failure.
LOCK TABLE mcp_tool IN SHARE ROW EXCLUSIVE MODE;

UPDATE mcp_tool
SET declared_execution_semantics_json = execution_semantics_json
WHERE declared_execution_semantics_json IS NULL
  AND execution_semantics_json->>'source' = 'mcp_declared';

UPDATE mcp_tool
SET admin_execution_semantics_override_json = execution_semantics_json
WHERE declared_execution_semantics_json IS NULL
  AND admin_execution_semantics_override_json IS NULL
  AND execution_semantics_json->>'source' = 'admin_override';

ALTER TABLE mcp_tool
  ADD CONSTRAINT mcp_tool_execution_semantics_authority_check CHECK (
    CASE execution_semantics_json->>'source'
      WHEN 'mcp_declared' THEN
        declared_execution_semantics_json IS NOT NULL
        AND declared_execution_semantics_json = execution_semantics_json
        AND (
          admin_execution_semantics_override_json IS NULL
          OR admin_execution_semantics_override_json->>'source' = 'admin_override'
        )
      WHEN 'admin_override' THEN
        declared_execution_semantics_json IS NULL
        AND admin_execution_semantics_override_json IS NOT NULL
        AND admin_execution_semantics_override_json = execution_semantics_json
      WHEN 'default_unknown' THEN
        declared_execution_semantics_json IS NULL
        AND admin_execution_semantics_override_json IS NULL
      ELSE false
    END
  );

INSERT INTO schema_migration(version)
VALUES ('0152_v14_mcp_execution_semantics_authority_repair');

COMMIT;
