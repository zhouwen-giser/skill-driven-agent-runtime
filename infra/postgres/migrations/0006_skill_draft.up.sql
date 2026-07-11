BEGIN;
CREATE TABLE IF NOT EXISTS skill_draft (
  draft_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id),
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  requested_by text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('create', 'update')),
  request_text text NOT NULL,
  status text NOT NULL CHECK (status = 'draft'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS skill_draft_context_created
  ON skill_draft (context_id, created_at, draft_id);
INSERT INTO schema_migration (version) VALUES ('0006_skill_draft') ON CONFLICT (version) DO NOTHING;
COMMIT;
