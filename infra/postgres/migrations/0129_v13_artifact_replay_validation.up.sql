-- 0129_v13_artifact_replay_validation.up.sql
-- P05: immutable replay datasets and PostgreSQL-authoritative validation work.

BEGIN;

CREATE TABLE artifact_replay_case (
  replay_case_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_type_id text NOT NULL,
  primary_source_episode_id text NOT NULL
    REFERENCES goal_experience_episode(episode_id) ON DELETE CASCADE,
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND octet_length(content::text) <= 1048576
    AND sdar_jsonb_depth(content) <= 32
  ),
  fixture jsonb NOT NULL CHECK (
    jsonb_typeof(fixture) = 'object'
    AND octet_length(fixture::text) <= 1048576
    AND sdar_jsonb_depth(fixture) <= 32
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_completeness numeric(7,6) NOT NULL CHECK (snapshot_completeness BETWEEN 0 AND 1),
  retention_until timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, primary_source_episode_id, content_hash)
);
CREATE INDEX artifact_replay_case_scope_idx
  ON artifact_replay_case(tenant_id, task_type_id, created_at, replay_case_id);

CREATE TABLE artifact_replay_tenant_deletion (
  tenant_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL
);

CREATE TABLE replay_dataset_manifest (
  dataset_id text NOT NULL,
  dataset_version integer NOT NULL CHECK (dataset_version >= 1),
  purpose text NOT NULL CHECK (
    purpose IN ('discovery','candidate_development','promotion_holdout','counterexample')
  ),
  tenant_id text NOT NULL,
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND octet_length(content::text) <= 1048576
    AND sdar_jsonb_depth(content) <= 32
  ),
  source_hash text NOT NULL CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  leakage_check_ref text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(dataset_id, dataset_version),
  UNIQUE(tenant_id, purpose, content_hash)
);
CREATE INDEX replay_dataset_manifest_scope_idx
  ON replay_dataset_manifest(tenant_id, purpose, created_at, dataset_id);

CREATE TABLE replay_dataset_case (
  dataset_id text NOT NULL,
  dataset_version integer NOT NULL,
  replay_case_id text NOT NULL REFERENCES artifact_replay_case(replay_case_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY(dataset_id, dataset_version, replay_case_id),
  UNIQUE(dataset_id, dataset_version, ordinal),
  FOREIGN KEY(dataset_id, dataset_version)
    REFERENCES replay_dataset_manifest(dataset_id, dataset_version) ON DELETE CASCADE
);

ALTER TABLE artifact_validation_run
  ADD COLUMN tenant_id text,
  ADD COLUMN dataset_version integer,
  ADD COLUMN artifact_hash text CHECK (
    artifact_hash IS NULL OR artifact_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN dataset_hash text CHECK (
    dataset_hash IS NULL OR dataset_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN validator_version text,
  ADD COLUMN metric_catalog_version text,
  ADD COLUMN result_hash text CHECK (
    result_hash IS NULL OR result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN result_payload jsonb CHECK (
    result_payload IS NULL OR (
      jsonb_typeof(result_payload) = 'object'
      AND octet_length(result_payload::text) <= 1048576
      AND sdar_jsonb_depth(result_payload) <= 32
    )
  ),
  ADD COLUMN work_state text NOT NULL DEFAULT 'completed' CHECK (
    work_state IN ('pending','leased','retry_wait','completed','dead_letter','canceled')
  ),
  ADD COLUMN attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 32),
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_token text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN idempotency_key text,
  ADD COLUMN source_event_id text,
  ADD COLUMN last_error_code text,
  ADD COLUMN last_error_summary text CHECK (
    last_error_summary IS NULL OR length(last_error_summary) BETWEEN 1 AND 2048
  ),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE artifact_validation_run
SET idempotency_key = 'legacy:' || validation_run_id,
    available_at = started_at,
    created_at = started_at,
    updated_at = COALESCE(completed_at, started_at)
WHERE idempotency_key IS NULL;

ALTER TABLE artifact_validation_run
  ADD CONSTRAINT artifact_validation_run_replay_dataset_fk
    FOREIGN KEY(dataset_ref, dataset_version)
    REFERENCES replay_dataset_manifest(dataset_id, dataset_version) ON DELETE CASCADE,
  ADD CONSTRAINT artifact_validation_run_lease_check CHECK (
    (work_state = 'leased') = (
      lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT artifact_validation_run_replay_pin_check CHECK (
    dataset_version IS NULL OR (
      tenant_id IS NOT NULL
      AND artifact_hash IS NOT NULL
      AND dataset_hash IS NOT NULL
      AND validator_version IS NOT NULL
      AND metric_catalog_version IS NOT NULL
      AND idempotency_key IS NOT NULL
    )
  );

CREATE UNIQUE INDEX artifact_validation_run_idempotency_idx
  ON artifact_validation_run(idempotency_key);
CREATE UNIQUE INDEX artifact_validation_run_source_event_idx
  ON artifact_validation_run(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX artifact_validation_run_work_idx
  ON artifact_validation_run(work_state, available_at, validation_run_id);
CREATE INDEX artifact_validation_run_expired_lease_idx
  ON artifact_validation_run(lease_expires_at, validation_run_id)
  WHERE work_state='leased';

CREATE TABLE artifact_replay_case_result (
  validation_run_id text NOT NULL
    REFERENCES artifact_validation_run(validation_run_id) ON DELETE CASCADE,
  replay_case_id text NOT NULL
    REFERENCES artifact_replay_case(replay_case_id) ON DELETE CASCADE,
  evaluation jsonb NOT NULL CHECK (
    jsonb_typeof(evaluation) = 'object'
    AND octet_length(evaluation::text) <= 1048576
    AND sdar_jsonb_depth(evaluation) <= 32
  ),
  metrics jsonb NOT NULL CHECK (
    jsonb_typeof(metrics) = 'object'
    AND octet_length(metrics::text) <= 262144
    AND sdar_jsonb_depth(metrics) <= 16
  ),
  result_hash text NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(validation_run_id, replay_case_id)
);

CREATE TABLE artifact_validation_failure (
  failure_id text PRIMARY KEY,
  validation_run_id text NOT NULL
    REFERENCES artifact_validation_run(validation_run_id) ON DELETE CASCADE,
  replay_case_id text NOT NULL
    REFERENCES artifact_replay_case(replay_case_id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','minor','major','critical')),
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND octet_length(content::text) <= 262144
    AND sdar_jsonb_depth(content) <= 16
  ),
  created_at timestamptz NOT NULL
);
CREATE INDEX artifact_validation_failure_run_idx
  ON artifact_validation_failure(validation_run_id, severity, failure_id);

CREATE TABLE artifact_counterexample (
  counterexample_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  replay_case_id text NOT NULL
    REFERENCES artifact_replay_case(replay_case_id) ON DELETE CASCADE,
  failure_id text NOT NULL
    REFERENCES artifact_validation_failure(failure_id) ON DELETE CASCADE,
  validation_run_id text NOT NULL
    REFERENCES artifact_validation_run(validation_run_id) ON DELETE CASCADE,
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND octet_length(content::text) <= 262144
    AND sdar_jsonb_depth(content) <= 16
  ),
  condition_fingerprint text NOT NULL CHECK (
    condition_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL CHECK (status IN ('recorded','reviewed','superseded')),
  created_at timestamptz NOT NULL,
  FOREIGN KEY(artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version)
);
CREATE INDEX artifact_counterexample_lineage_idx
  ON artifact_counterexample(artifact_id, artifact_version, replay_case_id);

CREATE FUNCTION sdar_reject_artifact_replay_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Replay Case, Dataset, Result, Failure and Counterexample content is immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER artifact_replay_case_immutability
BEFORE UPDATE ON artifact_replay_case
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_replay_content_mutation();
CREATE TRIGGER replay_dataset_manifest_immutability
BEFORE UPDATE ON replay_dataset_manifest
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_replay_content_mutation();
CREATE TRIGGER artifact_replay_case_result_immutability
BEFORE UPDATE ON artifact_replay_case_result
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_replay_content_mutation();
CREATE TRIGGER artifact_validation_failure_immutability
BEFORE UPDATE ON artifact_validation_failure
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_replay_content_mutation();
CREATE TRIGGER artifact_counterexample_immutability
BEFORE UPDATE ON artifact_counterexample
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_replay_content_mutation();

-- Removing a source Case invalidates every immutable Dataset that contains it.
CREATE FUNCTION sdar_delete_replay_datasets_for_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM replay_dataset_manifest manifest
  USING replay_dataset_case member
  WHERE member.replay_case_id=OLD.replay_case_id
    AND manifest.dataset_id=member.dataset_id
    AND manifest.dataset_version=member.dataset_version;
  RETURN OLD;
END
$$;

CREATE TRIGGER artifact_replay_case_delete_propagation
BEFORE DELETE ON artifact_replay_case
FOR EACH ROW EXECUTE FUNCTION sdar_delete_replay_datasets_for_case();

INSERT INTO schema_migration(version)
VALUES('0129_v13_artifact_replay_validation');

COMMIT;
