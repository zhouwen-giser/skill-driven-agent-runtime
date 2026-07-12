BEGIN;

CREATE TABLE IF NOT EXISTS evolution_experience (
  experience_id text PRIMARY KEY,
  control_id text NOT NULL REFERENCES workflow_control(control_id),
  round_index integer NOT NULL CHECK (round_index >= 0),
  task_id text REFERENCES agent_task(task_id),
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  goal_id text NOT NULL REFERENCES goal(goal_id),
  goal_json jsonb NOT NULL,
  workflow_json jsonb NOT NULL,
  instance_id text NOT NULL REFERENCES workflow_instance(instance_id),
  skill_versions_json jsonb NOT NULL,
  tools_json jsonb NOT NULL,
  input_json jsonb NOT NULL,
  result_json jsonb,
  errors_json jsonb NOT NULL,
  evaluation_json jsonb NOT NULL,
  successful boolean NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL,
  UNIQUE(control_id, round_index)
);

CREATE INDEX IF NOT EXISTS evolution_experience_goal_idx
  ON evolution_experience(goal_id, created_at);
CREATE INDEX IF NOT EXISTS evolution_experience_skill_versions_gin
  ON evolution_experience USING gin(skill_versions_json);

INSERT INTO schema_migration(version) VALUES('0038_evolution_experience')
ON CONFLICT(version) DO NOTHING;

COMMIT;
