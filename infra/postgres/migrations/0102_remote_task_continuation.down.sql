BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_continuation_attempt)
    OR EXISTS (SELECT 1 FROM workflow_continuation_wait_binding)
    OR EXISTS (SELECT 1 FROM workflow_continuation_snapshot)
    OR EXISTS (
      SELECT 1
      FROM remote_task_control_event
      WHERE continuation_claim_attempt > 0
        OR continuation_claim_token IS NOT NULL
        OR continuation_claim_expires_at IS NOT NULL
    )
    OR EXISTS (SELECT 1 FROM workflow_instance WHERE status = 'waiting_external')
    OR EXISTS (SELECT 1 FROM skill_call_workflow WHERE status = 'waiting_external')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = '0102 rollback refused: remote Task continuation evidence or waiting execution exists';
  END IF;
END $$;

DROP INDEX skill_call_workflow_child_instance_continuation_idx;
ALTER TABLE skill_call_workflow DROP CONSTRAINT skill_call_workflow_status_check;
ALTER TABLE skill_call_workflow ADD CONSTRAINT skill_call_workflow_status_check CHECK(
  status IN (
    'awaiting_confirmation','running','succeeded','failed','canceled','rejected','invalidated'
  )
);

DROP TABLE workflow_continuation_attempt;
DROP TABLE workflow_continuation_wait_binding;
DROP TABLE workflow_continuation_snapshot;

DROP INDEX remote_task_control_continuation_inbox_idx;
DROP INDEX remote_task_control_continuation_claim_token_idx;
ALTER TABLE remote_task_control_event
  DROP CONSTRAINT remote_task_control_continuation_claim_check,
  DROP COLUMN continuation_claim_attempt,
  DROP COLUMN continuation_claim_expires_at,
  DROP COLUMN continuation_claim_token;

ALTER TABLE workflow_instance DROP CONSTRAINT workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed','canceled','invalidated')
);

DELETE FROM schema_migration WHERE version='0102_remote_task_continuation';

COMMIT;
