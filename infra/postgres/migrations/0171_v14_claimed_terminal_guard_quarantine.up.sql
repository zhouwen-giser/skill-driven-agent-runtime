BEGIN;

WITH irrecoverable AS (
  SELECT control.event_id,control.binding_id
  FROM remote_task_control_event AS control
  JOIN remote_task_binding AS binding ON binding.binding_id=control.binding_id
  JOIN workflow_control AS workflow ON workflow.task_id=binding.agent_task_id
  WHERE control.status IN ('pending','claimed')
    AND workflow.status='failed'
    AND binding.local_state IN ('terminal_event_pending','terminal_event_claimed')
    AND EXISTS (
      SELECT 1 FROM workflow_continuation_attempt AS attempt
      WHERE attempt.event_id=control.event_id AND attempt.status='succeeded'
    )
), failed_controls AS (
  UPDATE remote_task_control_event AS control
  SET status='failed',
      claimed_at=COALESCE(control.claimed_at,clock_timestamp()),
      processed_at=clock_timestamp(),
      error_code=COALESCE(control.error_code,'TASK_CAPABILITY_TERMINAL_GUARD_FAILED'),
      continuation_claim_token=NULL,
      continuation_claim_expires_at=NULL
  FROM irrecoverable
  WHERE control.event_id=irrecoverable.event_id
  RETURNING irrecoverable.binding_id
)
UPDATE remote_task_binding AS binding
SET local_state='quarantined',
    next_poll_at=NULL,
    poll_claim_token=NULL,
    poll_claimed_at=NULL,
    poll_claim_expires_at=NULL,
    version=binding.version+1,
    updated_at=clock_timestamp()
WHERE binding.binding_id IN (SELECT binding_id FROM failed_controls);

INSERT INTO schema_migration(version)
VALUES ('0171_v14_claimed_terminal_guard_quarantine');

COMMIT;
