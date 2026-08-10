BEGIN;

DROP TABLE evidence_coverage_reconcile_target;
DROP TABLE evidence_recovery_run;

ALTER TABLE evidence_dead_letter
  DROP CONSTRAINT evidence_dead_letter_requeue_metadata_ck,
  DROP COLUMN requeue_reason,
  DROP COLUMN requeued_by,
  DROP COLUMN requeue_count;

DELETE FROM schema_migration
WHERE version='0148_v14_evidence_operations_recovery';

COMMIT;
