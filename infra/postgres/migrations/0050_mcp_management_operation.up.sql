BEGIN;

CREATE TABLE IF NOT EXISTS mcp_management_operation (
  operation_id text PRIMARY KEY,
  server_id text NOT NULL,
  operation_type text NOT NULL CHECK (
    operation_type IN (
      'register', 'refresh', 'health_check', 'credentials_update',
      'tool_metadata_update', 'delete'
    )
  ),
  actor text NOT NULL CHECK (actor = 'anonymous-management'),
  target text,
  summary_json jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS mcp_management_operation_server_idx
  ON mcp_management_operation(server_id, occurred_at DESC);

COMMIT;
