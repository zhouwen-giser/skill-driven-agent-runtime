BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM skill_call_workflow
    WHERE status NOT IN ('succeeded','failed','canceled')
       OR completed_at IS NULL
       OR child_instance_id IS NULL
  ) THEN
    RAISE EXCEPTION '0057 rollback requires all child confirmation records to be terminal';
  END IF;
END $$;

DROP INDEX IF EXISTS skill_call_workflow_pending_confirmation_idx;

ALTER TABLE skill_call_workflow
  DROP CONSTRAINT IF EXISTS skill_call_workflow_status_check,
  DROP CONSTRAINT IF EXISTS skill_call_workflow_confirmation_status_check,
  DROP CONSTRAINT IF EXISTS skill_call_workflow_parent_plan_fk;

ALTER TABLE skill_call_workflow
  ALTER COLUMN child_instance_id SET NOT NULL,
  ALTER COLUMN completed_at SET NOT NULL,
  ADD CONSTRAINT skill_call_workflow_status_check
    CHECK(status IN ('succeeded','failed','canceled')),
  DROP COLUMN IF EXISTS confirmation_status,
  DROP COLUMN IF EXISTS parent_plan_id;

DELETE FROM schema_migration WHERE version='0057_nested_skill_confirmation';

COMMIT;
