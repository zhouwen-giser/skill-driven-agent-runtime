BEGIN;

DELETE FROM mcp_management_operation WHERE operation_type='tool_semantics_override';
ALTER TABLE mcp_management_operation
  DROP CONSTRAINT IF EXISTS mcp_management_operation_operation_type_check;
ALTER TABLE mcp_management_operation
  ADD CONSTRAINT mcp_management_operation_operation_type_check CHECK (
    operation_type IN (
      'register', 'refresh', 'health_check', 'credentials_update',
      'tool_metadata_update', 'delete'
    )
  );

ALTER TABLE workflow_plan_attempt
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_tool_execution_semantics_array_check,
  DROP COLUMN IF EXISTS tool_execution_semantics_json;

ALTER TABLE workflow_plan
  DROP CONSTRAINT IF EXISTS workflow_plan_tool_execution_semantics_array_check,
  DROP COLUMN IF EXISTS tool_execution_semantics_json;

ALTER TABLE mcp_invocation
  DROP CONSTRAINT IF EXISTS mcp_invocation_execution_semantics_object_check,
  DROP COLUMN IF EXISTS execution_semantics_json;

ALTER TABLE mcp_tool
  DROP CONSTRAINT IF EXISTS mcp_tool_declared_execution_semantics_object_check,
  DROP CONSTRAINT IF EXISTS mcp_tool_admin_execution_semantics_override_object_check,
  DROP CONSTRAINT IF EXISTS mcp_tool_execution_semantics_object_check,
  DROP COLUMN IF EXISTS declared_execution_semantics_json,
  DROP COLUMN IF EXISTS admin_execution_semantics_override_json,
  DROP COLUMN IF EXISTS execution_semantics_json;

DELETE FROM schema_migration WHERE version='0063_mcp_tool_execution_semantics';

COMMIT;
