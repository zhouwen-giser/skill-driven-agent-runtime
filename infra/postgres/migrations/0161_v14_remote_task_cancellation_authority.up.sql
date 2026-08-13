BEGIN;

ALTER TABLE remote_task_binding
  ADD COLUMN task_cancellation text;

-- Existing bindings predate this frozen authority. Mark them unknown rather than inferring
-- capability from a later catalog revision. This keeps legacy rows safely updatable while
-- making every persisted binding explicit after the migration.
UPDATE remote_task_binding
SET task_cancellation='unknown'
WHERE task_cancellation IS NULL;

ALTER TABLE remote_task_binding
  ALTER COLUMN task_cancellation SET NOT NULL,
  ADD CONSTRAINT remote_task_binding_task_cancellation_check CHECK ((
    task_cancellation IN ('unsupported','cooperative','task_cancel','unknown')
  ) IS TRUE);

-- Admission receipts are the crash-recovery authority. Legacy receipts receive the
-- same conservative unknown marker; all future receipt transitions must retain an
-- explicit supported enum value.
UPDATE remote_task_admission_intent
SET remote_receipt_json=jsonb_set(
      remote_receipt_json,
      '{taskCancellation}',
      '"unknown"'::jsonb,
      true
    )
WHERE remote_receipt_json IS NOT NULL
  AND NOT (remote_receipt_json ? 'taskCancellation');

ALTER TABLE remote_task_admission_intent
  ADD CONSTRAINT remote_task_admission_receipt_cancellation_authority_check CHECK (
    remote_receipt_json IS NULL OR
    ((remote_receipt_json->>'taskCancellation' IN (
      'unsupported','cooperative','task_cancel','unknown'
    )) IS TRUE)
  );

INSERT INTO schema_migration(version)
VALUES('0161_v14_remote_task_cancellation_authority');

COMMIT;
