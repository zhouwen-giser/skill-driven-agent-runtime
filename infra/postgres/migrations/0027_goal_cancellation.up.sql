CREATE TABLE IF NOT EXISTS goal_cancellation (
  cancellation_id text PRIMARY KEY,
  goal_id text NOT NULL REFERENCES goal(goal_id),
  goal_version integer NOT NULL CHECK(goal_version > 0),
  reason text NOT NULL,
  canceled_task_ids_json jsonb NOT NULL,
  invalidated_plan_ids_json jsonb NOT NULL,
  canceled_instance_ids_json jsonb NOT NULL,
  warnings_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS goal_cancellation_goal_idx
  ON goal_cancellation(goal_id,created_at,cancellation_id);
