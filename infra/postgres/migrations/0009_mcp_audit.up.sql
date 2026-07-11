BEGIN;

CREATE TABLE IF NOT EXISTS mcp_dependency_warning (
  warning_id text PRIMARY KEY,
  server_id text NOT NULL,
  tool_name text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('removed', 'schema_changed')),
  skill_id text NOT NULL,
  skill_version integer NOT NULL,
  tool_revision integer NOT NULL CHECK (tool_revision > 0),
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  UNIQUE (server_id, tool_name, reason, skill_id, skill_version, tool_revision)
);

CREATE INDEX IF NOT EXISTS mcp_dependency_warning_server_idx
  ON mcp_dependency_warning(server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_invocation (
  invocation_id text PRIMARY KEY,
  task_id text,
  context_id text,
  server_id text NOT NULL,
  tool_name text NOT NULL,
  arguments_json jsonb NOT NULL,
  result_json jsonb,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'canceled')),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS mcp_invocation_server_idx
  ON mcp_invocation(server_id, started_at DESC);
CREATE INDEX IF NOT EXISTS mcp_invocation_task_idx
  ON mcp_invocation(task_id, started_at DESC) WHERE task_id IS NOT NULL;

COMMIT;
