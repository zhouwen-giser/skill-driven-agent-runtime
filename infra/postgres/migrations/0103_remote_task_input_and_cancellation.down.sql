BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM remote_task_input_attempt) OR
     EXISTS (SELECT 1 FROM remote_task_input_link) OR
     EXISTS (SELECT 1 FROM remote_task_cancel_attempt) OR
     EXISTS (SELECT 1 FROM remote_task_cancel_request) OR
     EXISTS (SELECT 1 FROM task_input_request WHERE source='remote_task') OR
     EXISTS (SELECT 1 FROM remote_task_binding WHERE local_state='cancel_observing') THEN
    RAISE EXCEPTION '0103 rollback requires exported and removed remote Task input/cancellation evidence';
  END IF;
END $$;

DROP TABLE remote_task_input_attempt;
DROP TABLE remote_task_input_link;
DROP FUNCTION enforce_remote_task_input_context_authority();
DROP TABLE remote_task_cancel_attempt;
DROP TABLE remote_task_cancel_request;

ALTER TABLE remote_task_binding DROP CONSTRAINT remote_task_binding_input_authority_unique;
DROP INDEX remote_task_binding_cancel_observation_idx;
ALTER TABLE remote_task_binding DROP CONSTRAINT remote_task_binding_next_poll_state_check;
ALTER TABLE remote_task_binding ADD CONSTRAINT remote_task_binding_next_poll_state_check CHECK(
  next_poll_at IS NULL OR local_state='polling'
);
ALTER TABLE remote_task_binding DROP CONSTRAINT remote_task_binding_local_state_check;
ALTER TABLE remote_task_binding ADD CONSTRAINT remote_task_binding_local_state_check CHECK(
  local_state IN (
    'polling','awaiting_input','terminal_event_pending','terminal_event_claimed',
    'reentered','closed','quarantined'
  )
);

ALTER TABLE task_input_request DROP CONSTRAINT task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK(
  source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow')
);

DELETE FROM schema_migration WHERE version='0103_remote_task_input_and_cancellation';

COMMIT;
