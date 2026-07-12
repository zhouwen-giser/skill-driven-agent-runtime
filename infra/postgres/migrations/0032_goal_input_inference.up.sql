BEGIN;
CREATE TABLE IF NOT EXISTS goal_input_inference (
  inference_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id),
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  outcome text NOT NULL CHECK(outcome IN ('inferred','input_required')),
  decision_summary text NOT NULL,
  used_sources_json jsonb NOT NULL,
  inferred_goal_json jsonb,
  clarification_question text,
  created_at timestamptz NOT NULL,
  CHECK(
    (outcome='inferred' AND inferred_goal_json IS NOT NULL AND clarification_question IS NULL) OR
    (outcome='input_required' AND inferred_goal_json IS NULL AND clarification_question IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS goal_input_inference_task_idx
  ON goal_input_inference(task_id,created_at,inference_id);
INSERT INTO schema_migration(version) VALUES('0032_goal_input_inference')
ON CONFLICT(version) DO NOTHING;
COMMIT;
