BEGIN;
CREATE TABLE IF NOT EXISTS skill_call_workflow (
  parent_instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE CASCADE,
  parent_node_id text NOT NULL,
  child_instance_id text NOT NULL UNIQUE REFERENCES workflow_instance(instance_id) ON DELETE CASCADE,
  child_plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK(skill_version > 0),
  status text NOT NULL CHECK(status IN ('succeeded','failed','canceled')),
  evaluation_summary text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY(parent_instance_id,parent_node_id),
  FOREIGN KEY(skill_id,skill_version) REFERENCES skill_version(skill_id,version)
);
CREATE INDEX IF NOT EXISTS skill_call_workflow_skill_version_idx
  ON skill_call_workflow(skill_id,skill_version,created_at DESC);
INSERT INTO schema_migration(version) VALUES('0034_skill_call_workflow')
ON CONFLICT(version) DO NOTHING;
COMMIT;
