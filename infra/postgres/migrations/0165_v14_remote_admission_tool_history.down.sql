BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM remote_task_admission_intent admission
    LEFT JOIN mcp_tool tool
      ON tool.server_id = admission.server_id
     AND tool.tool_name = admission.operation_name
    WHERE tool.server_id IS NULL
  ) THEN
    RAISE EXCEPTION 'REMOTE_ADMISSION_TOOL_HISTORY_ROLLBACK_REQUIRES_RECONCILIATION'
      USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE remote_task_admission_intent
  ADD CONSTRAINT remote_task_admission_tool_fk
  FOREIGN KEY(server_id,operation_name)
  REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT;

DELETE FROM schema_migration
WHERE version = '0165_v14_remote_admission_tool_history';

COMMIT;
