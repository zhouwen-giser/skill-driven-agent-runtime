BEGIN;

ALTER TABLE mcp_invocation
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN simulation_id text;

ALTER TABLE mcp_invocation
  ADD CONSTRAINT mcp_invocation_execution_context_check CHECK (
    (execution_mode = 'live' AND simulation_id IS NULL) OR
    (execution_mode IN ('simulation','historical-replay') AND length(btrim(simulation_id)) > 0)
  );

CREATE INDEX mcp_invocation_execution_mode_idx
  ON mcp_invocation(execution_mode,simulation_id,started_at);

INSERT INTO schema_migration(version) VALUES('0056_mcp_execution_mode')
ON CONFLICT(version) DO NOTHING;

COMMIT;
