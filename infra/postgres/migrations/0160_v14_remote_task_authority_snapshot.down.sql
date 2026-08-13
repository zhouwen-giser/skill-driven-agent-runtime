BEGIN;

ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT IF EXISTS remote_task_admission_receipt_authority_check;

ALTER TABLE remote_task_binding
  DROP CONSTRAINT IF EXISTS remote_task_binding_authority_snapshot_object_check,
  DROP COLUMN IF EXISTS authority_snapshot_json;

DELETE FROM schema_migration
WHERE version='0160_v14_remote_task_authority_snapshot';

COMMIT;
