BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM remote_task_admission_intent AS intent
    LEFT JOIN mcp_tool AS tool
      ON tool.server_id = intent.server_id
     AND tool.tool_name = intent.operation_name
    WHERE tool.server_id IS NULL
  ) THEN
    RAISE EXCEPTION '0165 rollback refused: remote admission catalog lineage is no longer present';
  END IF;
END;
$$;

ALTER TABLE remote_task_admission_intent
  ADD CONSTRAINT remote_task_admission_tool_fk
    FOREIGN KEY(server_id,operation_name)
    REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS mcp_tool_active_remote_task_guard ON mcp_tool;
DROP FUNCTION IF EXISTS protect_active_remote_task_tool_catalog();

DELETE FROM schema_migration
WHERE version = '0165_v14_remote_task_catalog_lineage';

COMMIT;
