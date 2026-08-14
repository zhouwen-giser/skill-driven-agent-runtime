BEGIN;

DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM remote_task_binding
       WHERE task_cancellation <> 'unknown'
     ) OR EXISTS (
       SELECT 1 FROM remote_task_binding
       WHERE terminal_at IS NULL
         AND local_state NOT IN ('closed','reentered','quarantined')
     ) OR EXISTS (
       SELECT 1 FROM remote_task_admission_intent
       WHERE remote_receipt_json ? 'taskCancellation'
         AND remote_receipt_json->>'taskCancellation' <> 'unknown'
     ) OR EXISTS (SELECT 1 FROM remote_task_cancel_request)
        OR EXISTS (SELECT 1 FROM remote_task_cancel_attempt) THEN
    RAISE EXCEPTION '0161 rollback refused: frozen cancellation authority, active binding, or cancellation evidence exists';
  END IF;
END;
$$;

ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT IF EXISTS remote_task_admission_receipt_cancellation_authority_check;

UPDATE remote_task_admission_intent
SET remote_receipt_json=remote_receipt_json - 'taskCancellation'
WHERE remote_receipt_json ? 'taskCancellation';

ALTER TABLE remote_task_binding
  DROP CONSTRAINT IF EXISTS remote_task_binding_task_cancellation_check,
  DROP COLUMN IF EXISTS task_cancellation;

DELETE FROM schema_migration
WHERE version='0161_v14_remote_task_cancellation_authority';

COMMIT;
