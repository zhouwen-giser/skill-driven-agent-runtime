BEGIN;
-- Historical Skill calls have no provable node-run identity. Keep them explicitly legacy;
-- never backfill a guessed iteration from static parent_node_id.
CREATE TABLE workflow_child_call (
  call_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('skill_call','subworkflow')),
  parent_instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  parent_node_run_id text NOT NULL CHECK (length(btrim(parent_node_run_id)) BETWEEN 1 AND 1024),
  parent_node_id text NOT NULL CHECK (length(btrim(parent_node_id)) BETWEEN 1 AND 256),
  child_plan_id text NOT NULL REFERENCES workflow_plan(plan_id) ON DELETE RESTRICT,
  child_instance_id text UNIQUE REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(parent_instance_id,parent_node_run_id),
  UNIQUE(call_id,parent_instance_id,parent_node_run_id),
  CHECK(child_instance_id IS DISTINCT FROM parent_instance_id)
);
ALTER TABLE skill_call_workflow ADD COLUMN parent_node_run_id text;
ALTER TABLE skill_call_workflow ADD CONSTRAINT skill_call_workflow_node_run_fk
  FOREIGN KEY(call_id,parent_instance_id,parent_node_run_id)
  REFERENCES workflow_child_call(call_id,parent_instance_id,parent_node_run_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX skill_call_workflow_node_run_idx
  ON skill_call_workflow(parent_instance_id,parent_node_run_id)
  WHERE parent_node_run_id IS NOT NULL;
INSERT INTO schema_migration(version) VALUES ('0180_v14_workflow_child_call');
COMMIT;
