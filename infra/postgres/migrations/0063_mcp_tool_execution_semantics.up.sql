BEGIN;

ALTER TABLE mcp_tool
  ADD COLUMN IF NOT EXISTS declared_execution_semantics_json jsonb,
  ADD COLUMN IF NOT EXISTS admin_execution_semantics_override_json jsonb,
  ADD COLUMN IF NOT EXISTS execution_semantics_json jsonb NOT NULL DEFAULT
    '{"effect":"unknown","execution":"unknown","cancellation":"unknown","idempotency":"unknown","replay":"unknown","source":"default_unknown"}'::jsonb;

ALTER TABLE mcp_invocation
  ADD COLUMN IF NOT EXISTS execution_semantics_json jsonb NOT NULL DEFAULT
    '{"effect":"unknown","execution":"unknown","cancellation":"unknown","idempotency":"unknown","replay":"unknown","source":"default_unknown"}'::jsonb;

ALTER TABLE workflow_plan
  ADD COLUMN IF NOT EXISTS tool_execution_semantics_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE workflow_plan_attempt
  ADD COLUMN IF NOT EXISTS tool_execution_semantics_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE mcp_tool
  DROP CONSTRAINT IF EXISTS mcp_tool_declared_execution_semantics_object_check,
  DROP CONSTRAINT IF EXISTS mcp_tool_admin_execution_semantics_override_object_check,
  DROP CONSTRAINT IF EXISTS mcp_tool_execution_semantics_object_check;
ALTER TABLE mcp_tool
  ADD CONSTRAINT mcp_tool_declared_execution_semantics_object_check CHECK (
    declared_execution_semantics_json IS NULL OR
    jsonb_typeof(declared_execution_semantics_json) = 'object'
  ),
  ADD CONSTRAINT mcp_tool_admin_execution_semantics_override_object_check CHECK (
    admin_execution_semantics_override_json IS NULL OR
    jsonb_typeof(admin_execution_semantics_override_json) = 'object'
  ),
  ADD CONSTRAINT mcp_tool_execution_semantics_object_check CHECK (
    jsonb_typeof(execution_semantics_json) = 'object'
  );

ALTER TABLE mcp_invocation
  DROP CONSTRAINT IF EXISTS mcp_invocation_execution_semantics_object_check;
ALTER TABLE mcp_invocation
  ADD CONSTRAINT mcp_invocation_execution_semantics_object_check CHECK (
    jsonb_typeof(execution_semantics_json) = 'object'
  );

ALTER TABLE workflow_plan
  DROP CONSTRAINT IF EXISTS workflow_plan_tool_execution_semantics_array_check;
ALTER TABLE workflow_plan
  ADD CONSTRAINT workflow_plan_tool_execution_semantics_array_check CHECK (
    jsonb_typeof(tool_execution_semantics_json) = 'array'
  );

ALTER TABLE workflow_plan_attempt
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_tool_execution_semantics_array_check;
ALTER TABLE workflow_plan_attempt
  ADD CONSTRAINT workflow_plan_attempt_tool_execution_semantics_array_check CHECK (
    jsonb_typeof(tool_execution_semantics_json) = 'array'
  );

ALTER TABLE mcp_management_operation
  DROP CONSTRAINT IF EXISTS mcp_management_operation_operation_type_check;
ALTER TABLE mcp_management_operation
  ADD CONSTRAINT mcp_management_operation_operation_type_check CHECK (
    operation_type IN (
      'register', 'refresh', 'health_check', 'credentials_update',
      'tool_metadata_update', 'tool_semantics_override', 'delete'
    )
  );

INSERT INTO schema_migration(version) VALUES('0063_mcp_tool_execution_semantics')
ON CONFLICT(version) DO NOTHING;

COMMIT;
