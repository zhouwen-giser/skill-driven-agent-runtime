BEGIN;

UPDATE remote_task_binding AS binding
SET local_state = 'quarantined',
    next_poll_at = NULL,
    poll_claim_token = NULL,
    poll_claimed_at = NULL,
    poll_claim_expires_at = NULL,
    version = binding.version + 1,
    updated_at = clock_timestamp()
FROM remote_task_control_event AS control
WHERE control.binding_id = binding.binding_id
  AND control.status = 'failed'
  AND binding.local_state IN ('terminal_event_pending','terminal_event_claimed')
  AND EXISTS (
    SELECT 1
    FROM workflow_continuation_attempt AS attempt
    WHERE attempt.event_id = control.event_id
      AND attempt.status = 'failed'
  );

INSERT INTO schema_migration(version)
VALUES ('0166_v14_failed_remote_continuation_quarantine');

COMMIT;
