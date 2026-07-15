BEGIN;

ALTER TABLE skill_call_workflow
  ADD COLUMN IF NOT EXISTS call_id text;

UPDATE skill_call_workflow
SET call_id = child_instance_id
WHERE call_id IS NULL;

ALTER TABLE skill_call_workflow
  ALTER COLUMN call_id SET NOT NULL;

ALTER TABLE skill_call_workflow
  DROP CONSTRAINT IF EXISTS skill_call_workflow_pkey;

ALTER TABLE skill_call_workflow
  ADD CONSTRAINT skill_call_workflow_pkey PRIMARY KEY(call_id);

CREATE INDEX IF NOT EXISTS skill_call_workflow_parent_node_history_idx
  ON skill_call_workflow(parent_instance_id,parent_node_id,created_at DESC,call_id DESC);

INSERT INTO schema_migration(version) VALUES('0054_skill_call_history')
ON CONFLICT(version) DO NOTHING;

COMMIT;
