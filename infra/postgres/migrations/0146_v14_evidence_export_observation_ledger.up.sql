BEGIN;

ALTER TABLE evidence_outbox
  ADD COLUMN observation_generation smallint NOT NULL DEFAULT 0
    CHECK(observation_generation IN (0,1));

CREATE SEQUENCE evidence_export_observation_sequence START WITH 1;

CREATE TABLE evidence_export_batch (
  ledger_sequence bigint PRIMARY KEY
    DEFAULT nextval('evidence_export_observation_sequence'),
  batch_id text NOT NULL UNIQUE,
  export_id text NOT NULL,
  source_partition text NOT NULL CHECK(length(btrim(source_partition))>0),
  configuration_revision bigint NOT NULL CHECK(configuration_revision>0),
  first_sequence bigint NOT NULL CHECK(first_sequence>=0),
  last_sequence bigint NOT NULL CHECK(last_sequence>=first_sequence),
  batch_hash char(71) NOT NULL CHECK(batch_hash ~ '^sha256:[a-f0-9]{64}$'),
  record_count integer NOT NULL CHECK(record_count>0),
  attempt_no integer NOT NULL CHECK(attempt_no>0),
  status text NOT NULL CHECK(status='attempted'),
  observation_generation smallint NOT NULL DEFAULT 1 CHECK(observation_generation=1),
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY(export_id,configuration_revision)
    REFERENCES evidence_export_configuration(export_id,revision),
  UNIQUE(batch_id,export_id,source_partition,batch_hash),
  UNIQUE(export_id,source_partition,attempt_no)
);

CREATE INDEX evidence_export_batch_cursor_idx
  ON evidence_export_batch(ledger_sequence,batch_id);

CREATE TABLE evidence_export_ack (
  ledger_sequence bigint PRIMARY KEY
    DEFAULT nextval('evidence_export_observation_sequence'),
  ack_id text NOT NULL UNIQUE,
  batch_id text NOT NULL,
  export_id text NOT NULL,
  source_partition text NOT NULL CHECK(length(btrim(source_partition))>0),
  acknowledged_sequence bigint CHECK(acknowledged_sequence IS NULL OR acknowledged_sequence>=0),
  batch_hash char(71) NOT NULL CHECK(batch_hash ~ '^sha256:[a-f0-9]{64}$'),
  ack_disposition text NOT NULL CHECK(ack_disposition IN ('accepted','partial','rejected')),
  error_code text,
  observation_generation smallint NOT NULL DEFAULT 1 CHECK(observation_generation=1),
  acknowledged_at timestamptz NOT NULL,
  FOREIGN KEY(batch_id,export_id,source_partition,batch_hash)
    REFERENCES evidence_export_batch(batch_id,export_id,source_partition,batch_hash),
  CHECK(
    (ack_disposition='rejected' AND acknowledged_sequence IS NULL AND error_code IS NOT NULL)
    OR
    (ack_disposition IN ('accepted','partial') AND acknowledged_sequence IS NOT NULL AND error_code IS NULL)
  ),
  UNIQUE(batch_id)
);

CREATE INDEX evidence_export_ack_cursor_idx
  ON evidence_export_ack(ledger_sequence,ack_id);

CREATE OR REPLACE FUNCTION reject_evidence_export_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_EXPORT_OBSERVATION_IMMUTABLE' USING ERRCODE='55000';
END $$;

CREATE TRIGGER evidence_export_batch_immutable
BEFORE UPDATE OR DELETE ON evidence_export_batch
FOR EACH ROW EXECUTE FUNCTION reject_evidence_export_ledger_mutation();
CREATE TRIGGER evidence_export_ack_immutable
BEFORE UPDATE OR DELETE ON evidence_export_ack
FOR EACH ROW EXECUTE FUNCTION reject_evidence_export_ledger_mutation();

INSERT INTO schema_migration(version)
VALUES ('0146_v14_evidence_export_observation_ledger');

COMMIT;
