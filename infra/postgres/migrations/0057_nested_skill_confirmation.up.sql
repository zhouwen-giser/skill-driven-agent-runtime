BEGIN;

ALTER TABLE skill_call_workflow
  ADD COLUMN IF NOT EXISTS parent_plan_id text,
  ADD COLUMN IF NOT EXISTS confirmation_status text;

UPDATE skill_call_workflow relation
SET parent_plan_id = parent.plan_id,
    confirmation_status = 'confirmed'
FROM workflow_instance parent
WHERE relation.parent_instance_id = parent.instance_id
  AND (relation.parent_plan_id IS NULL OR relation.confirmation_status IS NULL);

ALTER TABLE skill_call_workflow
  ALTER COLUMN parent_plan_id SET NOT NULL,
  ALTER COLUMN confirmation_status SET NOT NULL,
  ALTER COLUMN child_instance_id DROP NOT NULL,
  ALTER COLUMN completed_at DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS skill_call_workflow_status_check;

ALTER TABLE skill_call_workflow
  ADD CONSTRAINT skill_call_workflow_parent_plan_fk
    FOREIGN KEY(parent_plan_id) REFERENCES workflow_plan(plan_id),
  ADD CONSTRAINT skill_call_workflow_confirmation_status_check
    CHECK(confirmation_status IN ('awaiting_confirmation','confirmed','rejected','invalidated')),
  ADD CONSTRAINT skill_call_workflow_status_check
    CHECK(status IN (
      'awaiting_confirmation','running','succeeded','failed','canceled','rejected','invalidated'
    ));

CREATE INDEX IF NOT EXISTS skill_call_workflow_pending_confirmation_idx
  ON skill_call_workflow(parent_plan_id,confirmation_status,created_at DESC);

INSERT INTO schema_migration(version) VALUES('0057_nested_skill_confirmation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
