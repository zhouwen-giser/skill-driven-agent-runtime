BEGIN;
CREATE TABLE IF NOT EXISTS implicit_feedback (
  feedback_id text PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN (
    'accepted_result','continued_modification','repeated_submission','requested_redo','switched_skill'
  )),
  source_task_id text NOT NULL REFERENCES agent_task(task_id),
  trigger_task_id text NOT NULL REFERENCES agent_task(task_id),
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  confidence double precision NOT NULL CHECK(confidence > 0 AND confidence <= 0.5),
  evidence_summary text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS implicit_feedback_task_idx
  ON implicit_feedback(source_task_id,created_at,feedback_id);
INSERT INTO schema_migration(version) VALUES('0047_implicit_feedback') ON CONFLICT(version) DO NOTHING;
COMMIT;
