BEGIN;
LOCK TABLE workflow_child_call, skill_call_workflow IN ACCESS EXCLUSIVE MODE;
-- Read-only preflight: SELECT count(*) FROM workflow_child_call;
-- Old code cannot address node-run calls safely, including historical loop iterations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_child_call)
    OR EXISTS (SELECT 1 FROM skill_call_workflow WHERE parent_node_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WORKFLOW_CHILD_CALL_DOWNGRADE_REFERENCES_EXIST';
  END IF;
END $$;
DROP INDEX skill_call_workflow_node_run_idx;
ALTER TABLE skill_call_workflow DROP CONSTRAINT skill_call_workflow_node_run_fk;
ALTER TABLE skill_call_workflow DROP COLUMN parent_node_run_id;
DROP TABLE workflow_child_call;
DELETE FROM schema_migration WHERE version='0180_v14_workflow_child_call';
COMMIT;
