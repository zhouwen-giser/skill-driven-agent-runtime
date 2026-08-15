BEGIN;

CREATE FUNCTION protect_active_remote_task_tool_catalog()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM remote_task_admission_intent AS intent
    WHERE intent.server_id = OLD.server_id
      AND intent.operation_name = OLD.tool_name
      AND intent.status IN ('prepared','dispatching','receipt_recorded')
  ) OR EXISTS (
    SELECT 1
    FROM remote_task_binding AS binding
    WHERE binding.server_id = OLD.server_id
      AND binding.operation_name = OLD.tool_name
      AND binding.local_state NOT IN ('reentered','closed','quarantined')
  ) THEN
    RAISE EXCEPTION 'MCP_TOOL_ACTIVE_REMOTE_TASK_CONFLICT';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER mcp_tool_active_remote_task_guard
BEFORE DELETE ON mcp_tool
FOR EACH ROW EXECUTE FUNCTION protect_active_remote_task_tool_catalog();

-- Admission intents are sealed recovery/audit lineage and must outlive the
-- mutable Catalog row. The trigger above retains the former fail-closed
-- behavior for every nonterminal remote operation.
ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT remote_task_admission_tool_fk;

INSERT INTO schema_migration(version)
VALUES ('0165_v14_remote_task_catalog_lineage');

COMMIT;
