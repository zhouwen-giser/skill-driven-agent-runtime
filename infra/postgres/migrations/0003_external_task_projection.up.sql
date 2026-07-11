BEGIN;

CREATE TABLE IF NOT EXISTS external_task_projection (
  protocol text NOT NULL,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE CASCADE,
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  state text NOT NULL,
  status_timestamp timestamptz,
  document_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (protocol, task_id)
);

CREATE INDEX IF NOT EXISTS external_task_projection_list
  ON external_task_projection (protocol, context_id, state, status_timestamp, task_id);

INSERT INTO schema_migration (version)
VALUES ('0003_external_task_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
