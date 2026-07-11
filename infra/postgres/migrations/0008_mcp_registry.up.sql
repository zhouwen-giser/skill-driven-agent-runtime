BEGIN;

CREATE TABLE IF NOT EXISTS mcp_server (
  server_id text PRIMARY KEY,
  name text NOT NULL,
  endpoint text NOT NULL,
  transport text NOT NULL CHECK (transport = 'streamable_http'),
  status text NOT NULL CHECK (status IN ('enabled', 'disabled', 'unreachable')),
  tool_revision integer NOT NULL CHECK (tool_revision > 0),
  encrypted_credential text NOT NULL CHECK (encrypted_credential <> ''),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tool (
  server_id text NOT NULL REFERENCES mcp_server(server_id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  title text,
  description text,
  input_schema_json jsonb NOT NULL,
  enhancement_json jsonb,
  discovered_at timestamptz NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);

CREATE INDEX IF NOT EXISTS mcp_tool_server_idx ON mcp_tool(server_id, tool_name);

COMMIT;
