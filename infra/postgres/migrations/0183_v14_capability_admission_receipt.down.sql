BEGIN;
LOCK TABLE capability_admission_receipt IN ACCESS EXCLUSIVE MODE;
-- Read-only preflight: SELECT r.task_id,t.phase FROM capability_admission_receipt r JOIN agent_task t USING(task_id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM capability_admission_receipt) THEN
    RAISE EXCEPTION 'CAPABILITY_ADMISSION_RECEIPT_DOWNGRADE_REFERENCES';
  END IF;
END $$;
DROP TABLE capability_admission_receipt;
DELETE FROM schema_migration WHERE version='0183_v14_capability_admission_receipt';
COMMIT;
