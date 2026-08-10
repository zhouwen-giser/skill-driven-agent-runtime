BEGIN;

DROP TABLE IF EXISTS evidence_export_ack;
DROP TABLE IF EXISTS evidence_export_batch;
DROP FUNCTION IF EXISTS reject_evidence_export_ledger_mutation();
DROP SEQUENCE IF EXISTS evidence_export_observation_sequence;

ALTER TABLE evidence_outbox
  DROP COLUMN IF EXISTS observation_generation;

DELETE FROM schema_migration
WHERE version='0146_v14_evidence_export_observation_ledger';

COMMIT;
