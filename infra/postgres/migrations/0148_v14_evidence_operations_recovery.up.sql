BEGIN;

ALTER TABLE evidence_dead_letter
  ADD COLUMN requeue_count integer NOT NULL DEFAULT 0 CHECK (requeue_count >= 0),
  ADD COLUMN requeued_by text,
  ADD COLUMN requeue_reason text;

UPDATE evidence_dead_letter
SET requeue_count=1,
    requeued_by='pre-0148',
    requeue_reason='legacy requeue metadata unavailable'
WHERE requeued_at IS NOT NULL;

ALTER TABLE evidence_dead_letter
  ADD CONSTRAINT evidence_dead_letter_requeue_metadata_ck CHECK (
    (requeued_at IS NULL AND requeued_by IS NULL AND requeue_reason IS NULL)
    OR
    (requeued_at IS NOT NULL
      AND length(btrim(requeued_by)) BETWEEN 1 AND 256
      AND length(btrim(requeue_reason)) BETWEEN 1 AND 2048
      AND requeue_count > 0)
  );

CREATE TABLE evidence_recovery_run (
  recovery_run_id text PRIMARY KEY CHECK (length(btrim(recovery_run_id)) BETWEEN 1 AND 256),
  operation_id text NOT NULL UNIQUE CHECK (length(btrim(operation_id)) BETWEEN 1 AND 256),
  idempotency_key_hash char(71) NOT NULL UNIQUE
    CHECK (idempotency_key_hash ~ '^sha256:[a-f0-9]{64}$'),
  request_hash char(71) NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  export_id text NOT NULL,
  configuration_revision bigint NOT NULL CHECK (configuration_revision > 0),
  operation text NOT NULL CHECK (operation IN (
    'replay_record','replay_source_partition','replay_episode',
    'retry_dead_letter','reconcile_coverage','apply_retention'
  )),
  target jsonb NOT NULL CHECK (
    jsonb_typeof(target)='object' AND pg_column_size(target) <= 8192
  ),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 256),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2048),
  status text NOT NULL CHECK (status IN ('requested','running','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  affected_records integer CHECK (affected_records IS NULL OR affected_records >= 0),
  result_summary jsonb CHECK (
    result_summary IS NULL
    OR (jsonb_typeof(result_summary)='object' AND pg_column_size(result_summary) <= 65536)
  ),
  last_error_code text,
  requested_at timestamptz NOT NULL,
  wake_requested_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (wake_requested_at >= requested_at),
  CHECK (started_at IS NULL OR started_at >= requested_at),
  CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)),
  CHECK (
    (status='requested' AND started_at IS NULL AND completed_at IS NULL)
    OR (status='running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded','failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK ((status='failed') = (last_error_code IS NOT NULL)),
  FOREIGN KEY (export_id,configuration_revision)
    REFERENCES evidence_export_configuration(export_id,revision) ON DELETE RESTRICT
);

CREATE INDEX evidence_recovery_run_pending_idx
  ON evidence_recovery_run (requested_at,recovery_run_id)
  WHERE status IN ('requested','running');

CREATE INDEX evidence_recovery_run_target_idx
  ON evidence_recovery_run (operation,requested_at DESC,recovery_run_id);

CREATE TABLE evidence_coverage_reconcile_target (
  recovery_run_id text NOT NULL
    REFERENCES evidence_recovery_run(recovery_run_id) ON DELETE RESTRICT,
  episode_id text NOT NULL,
  requested_at timestamptz NOT NULL,
  claim_token text CHECK (claim_token IS NULL OR length(btrim(claim_token)) BETWEEN 1 AND 256),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at timestamptz,
  PRIMARY KEY (recovery_run_id,episode_id),
  CHECK ((claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
    OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL AND claimed_at >= requested_at
      AND claim_expires_at > claimed_at)),
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE INDEX evidence_coverage_reconcile_target_pending_idx
  ON evidence_coverage_reconcile_target (episode_id,requested_at,recovery_run_id)
  WHERE completed_at IS NULL;

INSERT INTO schema_migration(version)
VALUES ('0148_v14_evidence_operations_recovery');

COMMIT;
