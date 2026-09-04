BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM remote_task_reconciliation_attempt)
    OR EXISTS (SELECT 1 FROM remote_task_provider_execution_link) THEN
    RAISE EXCEPTION 'REMOTE_TASK_CONSUMER_SYNC_ROLLBACK_REQUIRES_EMPTY_STATE'
      USING ERRCODE='55000';
  END IF;
END $$;

DROP TRIGGER remote_task_provider_execution_link_immutable
  ON remote_task_provider_execution_link;
DROP TRIGGER remote_task_reconciliation_attempt_immutable
  ON remote_task_reconciliation_attempt;
DROP TABLE remote_task_provider_execution_link;
DROP TABLE remote_task_reconciliation_attempt;
DROP FUNCTION remote_task_consumer_sync_immutable();

ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT remote_task_admission_logical_identity_check,
  DROP COLUMN reconciliation_contract_json,
  DROP COLUMN logical_identity_hash,
  DROP COLUMN logical_invocation_id;

DELETE FROM schema_migration
WHERE version='0175_v14_mcp_task_consumer_sync';

COMMIT;
