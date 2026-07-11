BEGIN;
CREATE TABLE IF NOT EXISTS workflow_instance (
  instance_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  workflow_definition_id text NOT NULL,
  workflow_version integer NOT NULL CHECK(workflow_version > 0),
  goal_id text NOT NULL,
  goal_version integer NOT NULL CHECK(goal_version > 0),
  status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
  input_json jsonb NOT NULL,
  result_json jsonb,
  errors_json jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS workflow_node_event (
  event_id text PRIMARY KEY,
  instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence > 0),
  node_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('node_started','node_succeeded','node_failed')),
  event_timestamp timestamptz NOT NULL,
  summary text NOT NULL,
  UNIQUE(instance_id, sequence)
);
CREATE INDEX IF NOT EXISTS workflow_node_event_instance_idx
  ON workflow_node_event(instance_id, sequence);
INSERT INTO schema_migration(version) VALUES('0017_workflow_execution') ON CONFLICT(version) DO NOTHING;
COMMIT;
