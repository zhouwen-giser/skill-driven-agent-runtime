BEGIN;
CREATE TABLE IF NOT EXISTS task_quality_report (
  report_id text PRIMARY KEY,
  task_id text NOT NULL UNIQUE REFERENCES agent_task(task_id),
  goal_id text NOT NULL,
  goal_version integer NOT NULL CHECK(goal_version > 0),
  workflow_instance_id text NOT NULL REFERENCES workflow_instance(instance_id),
  processed_result_id text NOT NULL REFERENCES processed_result(result_id),
  assessments_json jsonb NOT NULL,
  overall_score double precision NOT NULL CHECK(overall_score >= 0 AND overall_score <= 1),
  status text NOT NULL CHECK(status IN ('passed','warning','failed')),
  created_at timestamptz NOT NULL
);
INSERT INTO schema_migration(version) VALUES('0046_task_quality_report') ON CONFLICT(version) DO NOTHING;
COMMIT;
