BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM governed_control_confirmation confirmation
    LEFT JOIN mcp_tool tool
      ON tool.server_id = confirmation.server_id
     AND tool.tool_name = confirmation.tool_name
    WHERE tool.server_id IS NULL
  ) THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_TOOL_HISTORY_ROLLBACK_REQUIRES_RECONCILIATION'
      USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE governed_control_confirmation
  ADD CONSTRAINT governed_control_confirmation_tool_fk
  FOREIGN KEY(server_id,tool_name)
  REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT;

DELETE FROM schema_migration
WHERE version = '0164_v14_governed_control_tool_history';

COMMIT;
